import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { GenericPasswordRequest, GenericPasswordResponse, ConfirmGenericPasswordResponse } from '@appremoto/contracts';
import { enrollmentId, RejectedEnrollmentWrite, type EnrollmentData, type EnrollmentRepository,
  type EnrollmentToken, type HeartbeatTokenRepository } from '../repositories/enrollment.ts';
import type { AuditRepository } from '../repositories/audit.ts';
import { decryptPassword, encryptPassword } from '../security/credentials.ts';
import { hashToken } from '../security/tokens.ts';

export class GenericPasswordError extends Error {
  readonly code: 'GENERIC_PASSWORD_DENIED' | 'GENERIC_PASSWORD_UNAVAILABLE' | 'GENERIC_PASSWORD_POLICY_CHANGED';
  constructor(code: GenericPasswordError['code'] = 'GENERIC_PASSWORD_UNAVAILABLE') { super(code); this.code = code; }
}
interface Context {
  repository: EnrollmentRepository;
  guard: Pick<HeartbeatTokenRepository, 'beginHeartbeatGuard' | 'endHeartbeatGuard' | 'matchesHeartbeatGuard' | 'getHeartbeatGuard'> | undefined;
  audit: AuditRepository; encryptionKey: Buffer; keyVersion: number; now: () => Date;
  genericPassword: ((token: EnrollmentToken, resumePending?: boolean) => Promise<string | undefined>) | undefined;
  request: GenericPasswordRequest; sourceIp: string; token: EnrollmentToken; confirm: boolean;
}
export async function rotateGenericPassword(c: Context): Promise<GenericPasswordResponse | ConfirmGenericPasswordResponse> {
  const { repository: repo, token, request } = c;
  const denied = () => new GenericPasswordError('GENERIC_PASSWORD_DENIED');
  const unavailable = () => new GenericPasswordError();
  const deviceId = enrollmentId('device', token.organization_id, request.deviceUuid);
  const receiptId = enrollmentId('receipt', token.id, request.deviceUuid);
  if (!c.genericPassword || !c.guard?.matchesHeartbeatGuard || !c.guard.getHeartbeatGuard || typeof token.generic_installer_id !== 'string' ||
      token.revoked_at !== null || token.active !== true || !await repo.organizationActive(token.organization_id)) throw denied();
  let receipt = await repo.snapshot('enrollment_receipts', receiptId);
  if (!receipt || receipt.organization_id !== token.organization_id || receipt.enrollment_token_id !== token.id ||
      receipt.device_id !== deviceId || receipt.device_uuid !== request.deviceUuid || receipt.status !== 'committed' ||
      receipt.token_use_consumed !== true || receipt.recovery_frozen !== false ||
      receipt.expected_use_count !== token.use_count || token.use_count !== 1) throw denied();
  async function verifyDevice() {
    const [device, proof] = await Promise.all([repo.snapshot('devices', deviceId), repo.snapshot('device_tokens', deviceId)]);
    if (!device || device.organization_id !== token.organization_id || device.device_uuid !== request.deviceUuid ||
        device.enabled !== true || !proof || proof.device_id !== deviceId || proof.revoked_at !== null ||
        typeof proof.token_hash !== 'string' || !/^[a-f0-9]{64}$/.test(proof.token_hash) ||
        !timingSafeEqual(Buffer.from(proof.token_hash, 'hex'), Buffer.from(hashToken(request.currentDeviceToken), 'hex'))) throw denied();
  }
  await verifyDevice();
  let started = typeof receipt.password_rotation_started_at === 'string' && Number.isFinite(Date.parse(receipt.password_rotation_started_at)) &&
    typeof receipt.password_rotation_target_hash === 'string' && /^[a-f0-9]{64}$/.test(receipt.password_rotation_target_hash) &&
    (receipt.password_rotation_completed == null || typeof receipt.password_rotation_completed === 'boolean') &&
    (receipt.password_rotation_write_started == null || typeof receipt.password_rotation_write_started === 'boolean');
  if (!started && (receipt.password_rotation_started_at != null || receipt.password_rotation_target_hash != null ||
      receipt.password_rotation_completed != null || receipt.password_rotation_write_started != null)) throw denied();
  const existingGuard = await c.guard.getHeartbeatGuard(deviceId);
  const ownedGuard = existingGuard?.operationId === receiptId && existingGuard.deviceTokenId === deviceId;
  if (!started && !ownedGuard && (c.confirm || !Number.isFinite(Date.parse(token.expires_at)) || Date.parse(token.expires_at) <= c.now().getTime())) throw denied();
  let targetPassword: string;
  try {
    const password = await c.genericPassword(token, started || ownedGuard);
    if (!password) throw new Error(); targetPassword = password;
  } catch { throw denied(); }
  const targetHash = hashToken(targetPassword);
  if (started && receipt.password_rotation_target_hash !== targetHash) throw new GenericPasswordError('GENERIC_PASSWORD_POLICY_CHANGED');
  const guard = ownedGuard ? existingGuard! : { deviceId, deviceTokenId: deviceId,
    startedAt: started ? receipt.password_rotation_started_at as string : c.now().toISOString(), operationId: receiptId };
  if (started && ownedGuard && existingGuard!.startedAt !== receipt.password_rotation_started_at) throw unavailable();
  if (receipt.password_rotation_completed !== true && !ownedGuard && !await c.guard.beginHeartbeatGuard(guard)) throw unavailable();
  if (!started) {
    // Initialize only immutable ownership/target fields. A late retry can never reset completion or write progress.
    const desired = { ...receipt, password_rotation_started_at: guard.startedAt, password_rotation_target_hash: targetHash };
    await repo.write('enrollment_receipts', receiptId, desired, receipt);
    const current = await repo.snapshot('enrollment_receipts', receiptId);
    if (!current || current.password_rotation_started_at !== desired.password_rotation_started_at ||
        current.password_rotation_target_hash !== targetHash) throw unavailable();
    receipt = current; started = true;
  }
  async function credentialMatchesTarget(): Promise<boolean> {
    const credential = await repo.snapshot('device_credentials', deviceId);
    if (!credential || credential.device_id !== deviceId) throw denied();
    try {
      return hashToken(decryptPassword({ passwordCiphertext: credential.password_ciphertext,
        passwordNonce: credential.password_nonce, passwordTag: credential.password_tag,
        keyVersion: credential.key_version }, c.encryptionKey, c.keyVersion)) === targetHash;
    } catch { throw unavailable(); }
  }
  if (receipt.password_rotation_completed === true) {
    if (!await credentialMatchesTarget()) throw denied();
    if (await c.guard.matchesHeartbeatGuard(guard) && !await c.guard.endHeartbeatGuard(guard)) throw unavailable();
    return c.confirm ? { deviceId, applied: true } : { deviceId, rustdeskPassword: targetPassword, rotationId: receiptId };
  }
  if (!await c.guard.matchesHeartbeatGuard(guard) && !await c.guard.beginHeartbeatGuard(guard)) throw unavailable();
  await verifyDevice();
  if (!c.confirm) return { deviceId, rustdeskPassword: targetPassword, rotationId: receiptId };
  if (!await credentialMatchesTarget()) {
    // Never repeat an indeterminate credential PATCH. Wait for its exact semantic result while keeping the guard.
    if (receipt.password_rotation_write_started === true) throw unavailable();
    const marked = { ...receipt, password_rotation_write_started: true };
    await repo.write('enrollment_receipts', receiptId, marked, receipt); receipt = marked;
    const confirmed = await repo.snapshot('enrollment_receipts', receiptId);
    if (!confirmed || confirmed.password_rotation_write_started !== true || confirmed.password_rotation_target_hash !== targetHash) throw unavailable();
    const previous = await repo.snapshot('device_credentials', deviceId); if (!previous || previous.device_id !== deviceId) throw denied();
    const envelope = encryptPassword(targetPassword, c.encryptionKey, c.keyVersion);
    const desired: EnrollmentData = { device_id: deviceId, password_ciphertext: envelope.passwordCiphertext,
      password_nonce: envelope.passwordNonce, password_tag: envelope.passwordTag, key_version: envelope.keyVersion };
    try { await repo.write('device_credentials', deviceId, desired, previous); }
    catch (error) {
      if (error instanceof RejectedEnrollmentWrite) await repo.write('enrollment_receipts', receiptId,
        { ...receipt, password_rotation_write_started: false }, receipt);
      throw unavailable();
    }
    if (!await credentialMatchesTarget()) throw unavailable();
  }
  await verifyDevice();
  await c.audit.record(randomUUID(), { organizationId: token.organization_id, deviceId, sourceIp: c.sourceIp,
    result: 'success', retry: true, recoveryRequired: false, operation: 'generic_password_confirm' });
  const completed = { ...receipt, password_rotation_completed: true };
  await repo.write('enrollment_receipts', receiptId, completed, receipt);
  const finished = await repo.snapshot('enrollment_receipts', receiptId);
  if (!finished || finished.password_rotation_completed !== true || finished.password_rotation_target_hash !== targetHash) throw unavailable();
  if (!await c.guard.endHeartbeatGuard(guard)) throw unavailable();
  return { deviceId, applied: true };
}
