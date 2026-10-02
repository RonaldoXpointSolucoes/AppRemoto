import { reconfigureExistingDevice } from './reconfigure-device.ts';
import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { ReconfigureRequestSchema, type ReconfigureRequest, type ReconfigureResponse, EnrollRequestSchema, EnrollResponseSchema,
  GenericPasswordRequestSchema, type GenericPasswordRequest, type GenericPasswordResponse, type ConfirmGenericPasswordResponse,
  type EnrollRequest, type EnrollResponse } from '@appremoto/contracts';
import { enrollmentId, IndeterminateEnrollmentWrite, sameEnrollmentState,
  type HeartbeatTokenRepository, type EnrollmentRepository, type EnrollmentToken, type EnrollmentKind, type EnrollmentData } from '../repositories/enrollment.ts';
import { rotateGenericPassword } from './generic-password.ts';
import type { AuditRepository, EnrollmentAudit } from '../repositories/audit.ts';
import { decryptPassword, encryptPassword } from '../security/credentials.ts';
import { deriveDeviceToken, hashToken } from '../security/tokens.ts';

export class EnrollmentError extends Error {
  readonly code: 'ENROLLMENT_DENIED' | 'ENROLLMENT_UNAVAILABLE';
  constructor(code: 'ENROLLMENT_DENIED' | 'ENROLLMENT_UNAVAILABLE' = 'ENROLLMENT_UNAVAILABLE') {
    super(code === 'ENROLLMENT_DENIED' ? 'Enrollment denied' : 'Enrollment unavailable');
    this.code = code;
  }
}
export type EnrollDevice = ((request: EnrollRequest, sourceIp: string) => Promise<EnrollResponse>) & {
  reconfigure?: (request: ReconfigureRequest, sourceIp: string) => Promise<ReconfigureResponse>;
  stageGenericPassword?: (request: GenericPasswordRequest, sourceIp: string) => Promise<GenericPasswordResponse>;
  confirmGenericPassword?: (request: GenericPasswordRequest, sourceIp: string) => Promise<ConfirmGenericPasswordResponse>;
};
export interface EnrollmentDependencies {
  repository: EnrollmentRepository;
  reconfigurationGuard?: Pick<HeartbeatTokenRepository, 'beginHeartbeatGuard' | 'endHeartbeatGuard'>;
  audit: AuditRepository;
  encryptionKey: Buffer;
  keyVersion: number;
  now?: () => Date;
  genericPassword?: (token: EnrollmentToken, resumePending?: boolean) => Promise<string | undefined>;
}

function strongPassword(): string {
  const classes = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789', '!@#$%&*-_+='];
  const alphabet = classes.join('');
  const chars = classes.map((set) => set[randomInt(set.length)]!);
  while (chars.length < 32) chars.push(alphabet[randomInt(alphabet.length)]!);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

// This lock is process-local: deployment must run one API process/replica.
function serialQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    tails.set(key, current);
    const cleanup = () => { if (tails.get(key) === current) tails.delete(key); };
    void current.then(cleanup, cleanup);
    return current;
  };
}

export function createEnrollmentService(dependencies: EnrollmentDependencies): EnrollDevice {
  const { repository: repo, audit, encryptionKey, keyVersion } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const tokenQueue = serialQueue(); const deviceQueue = serialQueue();
  let pendingCalls = 0;
  const poisonedTokens = new Set<string>();
  const uncertainWrites = new Map<string, { kind: EnrollmentKind; id: string; expected: EnrollmentData }>();

  async function execute(request: EnrollRequest, sourceIp: string, tokenHash: string, proof?: string): Promise<EnrollResponse | ReconfigureResponse> {
    const token = await repo.findToken(tokenHash);
    if (!token || token.token_hash !== tokenHash || !token.organization_id) throw new EnrollmentError('ENROLLMENT_DENIED');
    const genericPassword = dependencies.genericPassword ? await dependencies.genericPassword(token) : undefined;
    if (token.generic_installer_id != null && genericPassword === undefined) throw new EnrollmentError('ENROLLMENT_DENIED');
    const deviceId = enrollmentId('device', token.organization_id, request.deviceUuid);
    const event: EnrollmentAudit = { organizationId: token.organization_id, deviceId, sourceIp,
      retry: false, result: 'success', recoveryRequired: false };
    async function deny(reason: EnrollmentAudit['reason']): Promise<never> {
      try { await audit.record(randomUUID(), { ...event, result: 'failure', reason }); } catch { /* Denial must remain stable. */ }
      throw new EnrollmentError('ENROLLMENT_DENIED');
    }
    if (token.revoked_at !== null) return deny('token_inactive');
    if (!Number.isFinite(Date.parse(token.expires_at)) || Date.parse(token.expires_at) <= now().getTime()) return deny('token_expired');
    if (!Number.isSafeInteger(token.use_count) || token.use_count < 0 || !Number.isSafeInteger(token.max_uses) ||
        token.max_uses < 1 || token.use_count > token.max_uses) return deny('token_invalid');
    if (!await repo.organizationActive(token.organization_id)) return deny('organization_inactive');
    const unresolved = await repo.pendingReceipts(token.id);
    if (unresolved.some((receipt) => receipt.device_uuid !== request.deviceUuid || receipt.organization_id !== token.organization_id)) {
      return deny('pending_recovery');
    }
    async function freezeFromIndeterminateHandler(receiptId: string): Promise<boolean> {
      try {
        const frozen = (state: EnrollmentData | null) => state?.token_hash === tokenHash &&
          state.active === false && state.revoked_at === null;
        if (!frozen(await repo.freezeToken(token!.id, tokenHash))) return false;
        const durable = await repo.snapshot('enrollment_receipts', receiptId);
        if (!durable || durable.organization_id !== token!.organization_id || durable.enrollment_token_id !== token!.id ||
            durable.device_id !== deviceId || durable.device_uuid !== request.deviceUuid) return false;
        if (!frozen(await repo.snapshot('enrollment_tokens', token!.id))) return false;
        await repo.write('enrollment_receipts', receiptId, { ...durable, recovery_frozen: true }, durable);
        if ((await repo.snapshot('enrollment_receipts', receiptId))?.recovery_frozen !== true) return false;
        if (!frozen(await repo.snapshot('enrollment_tokens', token!.id))) return false;
        const uncertain = uncertainWrites.get(tokenHash);
        if (uncertain?.kind === 'enrollment_receipts' && uncertain.id === receiptId) {
          uncertain.expected = { ...uncertain.expected, recovery_frozen: true };
        }
        return true;
      } catch { return false; }
    }
    return deviceQueue(deviceId, async () => {
      const receiptId = enrollmentId('receipt', token.id, request.deviceUuid);
      const [receipt, device, deviceToken, credential] = await Promise.all([
        repo.snapshot('enrollment_receipts', receiptId), repo.snapshot('devices', deviceId),
        repo.snapshot('device_tokens', deviceId), repo.snapshot('device_credentials', deviceId),
      ]);
      if (proof) {
        return reconfigureExistingDevice({ repo, guard: dependencies.reconfigurationGuard, audit, now,
          token, tokenHash, request, proof, deviceId, receiptId, receipt, event, deny,
          ...(dependencies.genericPassword ? { authorizeSource: async () => { await dependencies.genericPassword!(token); } } : {}) });
      }
      const linked = receipt && receipt.organization_id === token.organization_id && receipt.enrollment_token_id === token.id &&
        receipt.device_id === deviceId && receipt.device_uuid === request.deviceUuid;
      const uncertain = uncertainWrites.get(tokenHash);
      const recovering = Boolean(linked && receipt.status === 'pending');
      const committed = Boolean(linked && receipt.status === 'committed' && receipt.token_use_consumed === true);
      event.retry = committed || recovering;
      const expectedCount = receipt?.expected_use_count;
      if (receipt && (!linked || !Number.isSafeInteger(expectedCount) || (expectedCount as number) < 1 ||
          (expectedCount as number) > token.max_uses || typeof receipt.recovery_frozen !== 'boolean')) return deny('identity_mismatch');
      const recoveryFrozen = receipt?.recovery_frozen === true;
      if (!token.active && !recoveryFrozen) return deny('token_inactive');
      if (recoveryFrozen && (token.active !== false || token.use_count !== expectedCount)) return deny('pending_recovery');
      if (committed) return deny('already_enrolled');
      if (recovering) {
        if (uncertain && !recoveryFrozen) return deny('pending_recovery');
        if (token.use_count !== expectedCount || (!uncertain && receipt!.token_use_consumed !== false)) return deny('pending_recovery');
        if (uncertain && uncertain.kind !== 'enrollment_tokens' &&
            !sameEnrollmentState(uncertain.kind, await repo.snapshot(uncertain.kind, uncertain.id), uncertain.expected)) {
          return deny('pending_recovery');
        }
      }
      if (recovering) {
        if (!device || device.organization_id !== token.organization_id || device.device_uuid !== request.deviceUuid ||
            device.enabled !== true || !deviceToken || deviceToken.device_id !== deviceId || !credential ||
            credential.device_id !== deviceId || token.use_count < (expectedCount as number)) return deny('identity_mismatch');
      } else {
        if (receipt && (receipt.enrollment_token_id === token.id && receipt.status === 'committed')) return deny('already_enrolled');
        if (token.use_count >= token.max_uses) return deny('token_exhausted');
      }
      const deviceTokenPlaintext = deriveDeviceToken(encryptionKey, { organizationId: token.organization_id,
        enrollmentTokenId: token.id, deviceId, deviceUuid: request.deviceUuid, receiptId });
      if (recovering) {
        let response: EnrollResponse;
        try {
          const storedHash = deviceToken!.token_hash;
          if (deviceToken!.revoked_at !== null || typeof storedHash !== 'string' || !/^[a-f0-9]{64}$/.test(storedHash) ||
              !timingSafeEqual(Buffer.from(storedHash, 'hex'), Buffer.from(hashToken(deviceTokenPlaintext), 'hex'))) throw new Error();
          const rustdeskPassword = decryptPassword({ passwordCiphertext: credential!.password_ciphertext,
            passwordNonce: credential!.password_nonce, passwordTag: credential!.password_tag, keyVersion: credential!.key_version }, encryptionKey, keyVersion);
          response = EnrollResponseSchema.parse({ deviceId, deviceToken: deviceTokenPlaintext, rustdeskPassword, heartbeatIntervalSeconds: 30 });
        } catch { return deny('identity_mismatch'); }
        const beforeReplay = await repo.snapshot('enrollment_tokens', token.id);
        if (!beforeReplay || beforeReplay.revoked_at !== null || !sameEnrollmentState('enrollment_tokens', beforeReplay, token)) {
          return deny('token_inactive');
        }
        if (recovering) {
          // Recovery only finalizes linkage; original credentials never change.
          try { await repo.write('enrollment_receipts', receiptId, { ...receipt!, status: 'committed', token_use_consumed: true }, receipt); }
          catch {
            try { await audit.record(randomUUID(), { ...event, result: 'failure', recoveryRequired: true, reason: 'storage_failure' }); }
            catch { /* Pending recovery remains durable even without audit availability. */ }
            throw new EnrollmentError();
          }
          const afterCommit = await repo.snapshot('enrollment_tokens', token.id);
          if (!afterCommit || afterCommit.revoked_at !== null || !sameEnrollmentState('enrollment_tokens', afterCommit, token)) {
            return deny('token_inactive');
          }
        }
        uncertainWrites.delete(tokenHash);
        return response;
      }
      const journal: Array<() => Promise<void>> = [];
      let indeterminate = false;
      async function write(kind: EnrollmentKind, id: string, data: EnrollmentData, previous: EnrollmentData | null) {
        journal.push(() => repo.restore(kind, id, previous, data));
        try { await repo.write(kind, id, data, previous); }
        catch (error) {
          if (error instanceof IndeterminateEnrollmentWrite) {
            indeterminate = true; uncertainWrites.set(tokenHash, { kind, id, expected: data });
          }
          throw error;
        }
      }
      try {
        const rustdeskPassword = genericPassword ?? strongPassword();
        const envelope = encryptPassword(rustdeskPassword, encryptionKey, keyVersion);
        const response = EnrollResponseSchema.parse({ deviceId, deviceToken: deviceTokenPlaintext, rustdeskPassword, heartbeatIntervalSeconds: 30 });
        const pending: EnrollmentData = { organization_id: token.organization_id, enrollment_token_id: token.id,
          device_id: deviceId, device_uuid: request.deviceUuid, status: 'pending', token_use_consumed: false,
          expected_use_count: token.use_count + 1, recovery_frozen: false };
        await write('enrollment_receipts', receiptId, pending, receipt);
        await write('devices', deviceId, { organization_id: token.organization_id, device_uuid: request.deviceUuid,
          display_name: request.displayName, hostname: request.hostname, operating_system: request.operatingSystem,
          os_version: request.osVersion, agent_version: request.agentVersion, rustdesk_id: request.rustdeskId,
          rustdesk_version: request.rustdeskVersion, enabled: true, last_seen_at: now().toISOString(), last_ip: sourceIp }, device);
        await write('device_tokens', deviceId, { device_id: deviceId, token_hash: hashToken(deviceTokenPlaintext),
          last_used_at: null, revoked_at: null }, deviceToken);
        await write('device_credentials', deviceId, { device_id: deviceId, password_ciphertext: envelope.passwordCiphertext,
          password_nonce: envelope.passwordNonce, password_tag: envelope.passwordTag, key_version: envelope.keyVersion }, credential);
        {
          const previous = await repo.snapshot('enrollment_tokens', token.id);
          if (!previous || previous.use_count !== token.use_count || previous.token_hash !== tokenHash || previous.active !== true || previous.revoked_at !== null) {
            throw new EnrollmentError();
          }
          await write('enrollment_tokens', token.id, { ...previous, use_count: pending.expected_use_count! }, previous);
        }
        await write('enrollment_receipts', receiptId, { ...pending, status: 'committed', token_use_consumed: true }, pending);
        const auditId = randomUUID(); journal.push(() => audit.remove(auditId));
        await audit.record(auditId, event);
        const finalToken = await repo.snapshot('enrollment_tokens', token.id);
        if (!finalToken || finalToken.active !== true || finalToken.revoked_at !== null) throw new EnrollmentError();
        if (dependencies.genericPassword) await dependencies.genericPassword(token);
        if (dependencies.reconfigurationGuard) {
          try { await dependencies.reconfigurationGuard.endHeartbeatGuard({ deviceId, deviceTokenId: deviceId, startedAt: now().toISOString() }); } catch {}
        }
        uncertainWrites.delete(tokenHash);
        return response;
      } catch {
        let recoveryRequired = indeterminate;
        if (indeterminate) {
          // Retain the receipt and credential artifacts: the server may still commit.
          await freezeFromIndeterminateHandler(receiptId);
        } else {
          for (const undo of journal.reverse()) {
            try { await undo(); } catch (error) {
              recoveryRequired = true;
              if (error instanceof IndeterminateEnrollmentWrite) {
                await freezeFromIndeterminateHandler(receiptId);
                break;
              }
            }
          }
          if (recoveryRequired) poisonedTokens.add(tokenHash);
        }
        try { await audit.record(randomUUID(), { ...event, result: 'failure', recoveryRequired, reason: 'storage_failure' }); } catch { /* Best effort only. */ }
        throw new EnrollmentError();
      }
    });
  }

  const dispatch = (input: EnrollRequest | ReconfigureRequest, sourceIp: string, reconfigure: boolean) => {
    const parsed = (reconfigure ? ReconfigureRequestSchema : EnrollRequestSchema).safeParse(input);
    if (!parsed.success) return Promise.reject(new EnrollmentError('ENROLLMENT_DENIED'));
    const request = { ...parsed.data, deviceUuid: parsed.data.deviceUuid.toLowerCase() };
    const tokenHash = hashToken(request.enrollmentToken);
    if (pendingCalls >= 1000 || poisonedTokens.size >= 1000 ||
        (uncertainWrites.size >= 1000 && !uncertainWrites.has(tokenHash)) || poisonedTokens.has(tokenHash)) {
      return Promise.reject(new EnrollmentError());
    }
    pendingCalls++;
    const result = tokenQueue(tokenHash, async () => {
      if (poisonedTokens.has(tokenHash)) throw new EnrollmentError();
      try { return await execute(request, sourceIp, tokenHash, reconfigure ? (parsed.data as ReconfigureRequest).currentDeviceToken : undefined); }
      catch (error) { throw error instanceof EnrollmentError ? error : new EnrollmentError(); }
    });
    const cleanup = () => { pendingCalls--; };
    void result.then(cleanup, cleanup);
    return result;
  };
  const dispatchRotation = (input: GenericPasswordRequest, sourceIp: string, confirm: boolean) => {
    const parsed = GenericPasswordRequestSchema.safeParse(input);
    if (!parsed.success || pendingCalls >= 1000) return Promise.reject(new EnrollmentError('ENROLLMENT_DENIED'));
    const request = { ...parsed.data, deviceUuid: parsed.data.deviceUuid.toLowerCase() };
    const tokenHash = hashToken(request.enrollmentToken); pendingCalls++;
    const result = tokenQueue(tokenHash, async () => {
      const token = await repo.findToken(tokenHash);
      if (!token || token.token_hash !== tokenHash) throw new EnrollmentError('ENROLLMENT_DENIED');
      const deviceId = enrollmentId('device', token.organization_id, request.deviceUuid);
      return deviceQueue(deviceId, () => rotateGenericPassword({ repository: repo, guard: dependencies.reconfigurationGuard,
        audit, encryptionKey, keyVersion, now, genericPassword: dependencies.genericPassword, request, sourceIp, token, confirm }));
    });
    const cleanup = () => { pendingCalls--; }; void result.then(cleanup, cleanup); return result;
  };
  return Object.assign((input: EnrollRequest, ip: string) => dispatch(input, ip, false) as Promise<EnrollResponse>, {
    reconfigure: (input: ReconfigureRequest, ip: string) => dispatch(input, ip, true) as Promise<ReconfigureResponse>,
    stageGenericPassword: (input: GenericPasswordRequest, ip: string) => dispatchRotation(input, ip, false) as Promise<GenericPasswordResponse>,
    confirmGenericPassword: (input: GenericPasswordRequest, ip: string) => dispatchRotation(input, ip, true) as Promise<ConfirmGenericPasswordResponse>,
  });
}
