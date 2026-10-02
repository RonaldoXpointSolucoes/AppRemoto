import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { EnrollRequest, ReconfigureResponse } from '@appremoto/contracts';
import { IndeterminateEnrollmentWrite, type EnrollmentData, type EnrollmentRepository,
  type EnrollmentToken, type HeartbeatTokenRepository } from '../repositories/enrollment.ts';
import type { AuditRepository, EnrollmentAudit } from '../repositories/audit.ts';
import { hashToken } from '../security/tokens.ts';

interface Context {
  repo: EnrollmentRepository;
  guard: Pick<HeartbeatTokenRepository, 'beginHeartbeatGuard' | 'endHeartbeatGuard'> | undefined;
  audit: AuditRepository;
  now: () => Date;
  token: EnrollmentToken;
  tokenHash: string;
  request: EnrollRequest;
  proof: string;
  deviceId: string;
  receiptId: string;
  receipt: EnrollmentData | null;
  event: EnrollmentAudit;
  deny: (reason: EnrollmentAudit['reason']) => Promise<never>;
  authorizeSource?: () => Promise<void>;
}

// Runs inside the enrollment token and device queues. Both an unexpired package
// and the machine's existing credential are required. Never returns a secret.
export async function reconfigureExistingDevice(c: Context): Promise<ReconfigureResponse> {
  const { repo, token, request, deviceId, receiptId, deny } = c;
  const unavailable = () => new Error('Reconfiguration unavailable');
  const proofHash = hashToken(c.proof);
  await c.authorizeSource?.();
  async function authorizedDevice(): Promise<EnrollmentData> {
    const [device, proof, credential] = await Promise.all([repo.snapshot('devices', deviceId),
      repo.snapshot('device_tokens', deviceId), repo.snapshot('device_credentials', deviceId)]);
    if (!device || device.organization_id !== token.organization_id || device.device_uuid !== request.deviceUuid ||
        device.enabled !== true || !proof || proof.device_id !== deviceId || proof.revoked_at !== null ||
        typeof proof.token_hash !== 'string' || !/^[a-f0-9]{64}$/.test(proof.token_hash) ||
        !timingSafeEqual(Buffer.from(proof.token_hash, 'hex'), Buffer.from(proofHash, 'hex')) ||
        !credential || credential.device_id !== deviceId) return deny('identity_mismatch');
    return device;
  }
  async function activeToken(count: number): Promise<EnrollmentData> {
    const current = await repo.snapshot('enrollment_tokens', token.id);
    if (!current || current.token_hash !== c.tokenHash || current.organization_id !== token.organization_id ||
        current.revoked_at !== null || current.active !== true || current.use_count !== count ||
        typeof current.expires_at !== 'string' || !Number.isFinite(Date.parse(current.expires_at)) ||
        Date.parse(current.expires_at) <= c.now().getTime()) return deny('token_inactive');
    return current;
  }
  const device = await authorizedDevice();
  const receipt = c.receipt;
  if (!token.active || receipt?.recovery_frozen === true) return deny('token_inactive');
  if (receipt && (receipt.organization_id !== token.organization_id || receipt.enrollment_token_id !== token.id ||
      receipt.device_id !== deviceId || receipt.device_uuid !== request.deviceUuid ||
      !Number.isSafeInteger(receipt.expected_use_count) || (receipt.expected_use_count as number) < 1 ||
      (receipt.expected_use_count as number) > token.max_uses || receipt.recovery_frozen !== false)) return deny('identity_mismatch');
  if (receipt?.status === 'committed' && receipt.token_use_consumed === true) {
    // Lost acknowledgement: confirm without renaming again or replaying secrets.
    if (device.display_name !== request.displayName || token.use_count !== receipt.expected_use_count) return deny('already_enrolled');
    await activeToken(token.use_count);
    await c.authorizeSource?.();
    return { deviceId, reconfigured: true };
  }
  const expected = receipt ? receipt.expected_use_count as number : token.use_count + 1;
  if (receipt && (receipt.status !== 'pending' || receipt.token_use_consumed !== false ||
      ![expected - 1, expected].includes(token.use_count))) return deny('pending_recovery');
  if (!receipt && token.use_count >= token.max_uses) return deny('token_exhausted');
  if (!c.guard) throw unavailable();
  const guard = { deviceId, deviceTokenId: deviceId, startedAt: c.now().toISOString() };
  if (!await c.guard.beginHeartbeatGuard(guard)) throw unavailable();
  let uncertain = false;
  try {
    const currentDevice = await authorizedDevice();
    await c.authorizeSource?.();
    const currentToken = await activeToken(token.use_count);
    const pending: EnrollmentData = receipt ?? { organization_id: token.organization_id,
      enrollment_token_id: token.id, device_id: deviceId, device_uuid: request.deviceUuid,
      status: 'pending', token_use_consumed: false, expected_use_count: expected, recovery_frozen: false };
    if (!receipt) await repo.write('enrollment_receipts', receiptId, pending, null);
    if (currentToken.use_count === expected - 1) {
      await repo.write('enrollment_tokens', token.id, { ...currentToken, use_count: expected }, currentToken);
    }
    await activeToken(expected);
    // Narrow patch: identity, credentials and heartbeat data stay intact.
    await repo.write('devices', deviceId, { ...currentDevice, display_name: request.displayName }, currentDevice);
    await c.audit.record(randomUUID(), { ...c.event, retry: true });
    await repo.write('enrollment_receipts', receiptId, { ...pending, status: 'committed', token_use_consumed: true }, pending);
    await activeToken(expected);
    if ((await authorizedDevice()).display_name !== request.displayName) throw unavailable();
    await c.authorizeSource?.();
    return { deviceId, reconfigured: true };
  } catch (error) {
    uncertain = error instanceof IndeterminateEnrollmentWrite;
    if (uncertain) {
      // Keep the durable guard when a server write may still be in flight.
      try { await repo.freezeToken(token.id, c.tokenHash); } catch { /* Guard remains. */ }
    }
    try { await c.audit.record(randomUUID(), { ...c.event, retry: true, result: 'failure',
      recoveryRequired: uncertain, reason: 'storage_failure' }); } catch { /* Preserve durable state. */ }
    throw error;
  } finally {
    if (!uncertain && !await c.guard.endHeartbeatGuard(guard)) throw unavailable();
  }
}
