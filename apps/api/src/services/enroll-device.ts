import { randomInt, randomUUID } from 'node:crypto';
import { EnrollRequestSchema, EnrollResponseSchema, type EnrollRequest, type EnrollResponse } from '@appremoto/contracts';
import { enrollmentId, type EnrollmentRepository, type EnrollmentKind, type EnrollmentData } from '../repositories/enrollment.ts';
import type { AuditRepository, EnrollmentAudit } from '../repositories/audit.ts';
import { encryptPassword } from '../security/credentials.ts';
import { hashToken, issueToken } from '../security/tokens.ts';

export class EnrollmentError extends Error {
  readonly code: 'ENROLLMENT_DENIED' | 'ENROLLMENT_UNAVAILABLE';
  constructor(code: 'ENROLLMENT_DENIED' | 'ENROLLMENT_UNAVAILABLE' = 'ENROLLMENT_UNAVAILABLE') {
    super(code === 'ENROLLMENT_DENIED' ? 'Enrollment denied' : 'Enrollment unavailable');
    this.code = code;
  }
}
export type EnrollDevice = (request: EnrollRequest, sourceIp: string) => Promise<EnrollResponse>;
export interface EnrollmentDependencies {
  repository: EnrollmentRepository;
  audit: AuditRepository;
  encryptionKey: Buffer;
  keyVersion: number;
  now?: () => Date;
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
  const flights = new Map<string, Promise<EnrollResponse>>();
  const poisonedTokens = new Set<string>();

  async function execute(request: EnrollRequest, sourceIp: string, tokenHash: string): Promise<EnrollResponse> {
    const token = await repo.findToken(tokenHash);
    const denied = () => new EnrollmentError('ENROLLMENT_DENIED');
    if (!token || token.token_hash !== tokenHash || !token.active || !token.organization_id ||
        !Number.isFinite(Date.parse(token.expires_at)) || Date.parse(token.expires_at) <= now().getTime() ||
        !Number.isSafeInteger(token.use_count) || token.use_count < 0 ||
        !Number.isSafeInteger(token.max_uses) || token.max_uses < 1 || token.use_count > token.max_uses ||
        !await repo.organizationActive(token.organization_id)) throw denied();
    const deviceId = enrollmentId('device', token.organization_id, request.deviceUuid);
    return deviceQueue(deviceId, async () => {
      const receiptId = enrollmentId('receipt', token.id, request.deviceUuid);
      const [receipt, device, deviceToken, credential] = await Promise.all([
        repo.snapshot('enrollment_receipts', receiptId), repo.snapshot('devices', deviceId),
        repo.snapshot('device_tokens', deviceId), repo.snapshot('device_credentials', deviceId),
      ]);
      const linked = receipt && receipt.organization_id === token.organization_id && receipt.enrollment_token_id === token.id &&
        receipt.device_id === deviceId && receipt.device_uuid === request.deviceUuid;
      const retry = Boolean(linked && receipt.status === 'committed' && receipt.token_use_consumed === true);
      if (retry) {
        if (!device || device.organization_id !== token.organization_id || device.device_uuid !== request.deviceUuid ||
            device.enabled !== true || !deviceToken || deviceToken.device_id !== deviceId || !credential ||
            credential.device_id !== deviceId || token.use_count < 1) throw denied();
      } else {
        // Only this exact phase proves no prior credentials or token use survived.
        const untouched = linked && receipt.status === 'pending' && receipt.token_use_consumed === false && token.use_count === 0;
        if ((receipt && !untouched) || device || deviceToken || credential || token.use_count >= token.max_uses) throw denied();
      }

      const journal: Array<() => Promise<void>> = [];
      const event: EnrollmentAudit = { organizationId: token.organization_id, deviceId, sourceIp, retry,
        result: 'success', recoveryRequired: false };
      async function write(kind: EnrollmentKind, id: string, data: EnrollmentData, previous: EnrollmentData | null) {
        // Register before sending: an upstream timeout may occur after persistence.
        journal.push(() => repo.restore(kind, id, previous, data));
        await repo.write(kind, id, data, previous);
      }
      try {
        const deviceTokenPlaintext = issueToken(); const rustdeskPassword = strongPassword();
        const envelope = encryptPassword(rustdeskPassword, encryptionKey, keyVersion);
        const response = EnrollResponseSchema.parse({ deviceId, deviceToken: deviceTokenPlaintext, rustdeskPassword, heartbeatIntervalSeconds: 30 });
        const pending: EnrollmentData = { organization_id: token.organization_id, enrollment_token_id: token.id,
          device_id: deviceId, device_uuid: request.deviceUuid, status: 'pending', token_use_consumed: retry };
        await write('enrollment_receipts', receiptId, pending, receipt);
        await write('devices', deviceId, { organization_id: token.organization_id, device_uuid: request.deviceUuid,
          display_name: request.displayName, hostname: request.hostname, operating_system: request.operatingSystem,
          os_version: request.osVersion, agent_version: request.agentVersion, rustdesk_id: request.rustdeskId,
          rustdesk_version: request.rustdeskVersion, enabled: true, last_seen_at: now().toISOString(), last_ip: sourceIp }, device);
        await write('device_tokens', deviceId, { device_id: deviceId, token_hash: hashToken(deviceTokenPlaintext),
          last_used_at: null, revoked_at: null }, deviceToken);
        await write('device_credentials', deviceId, { device_id: deviceId, password_ciphertext: envelope.passwordCiphertext,
          password_nonce: envelope.passwordNonce, password_tag: envelope.passwordTag, key_version: envelope.keyVersion }, credential);
        if (!retry) {
          const previous = await repo.snapshot('enrollment_tokens', token.id);
          if (!previous || previous.use_count !== token.use_count || previous.token_hash !== tokenHash) throw denied();
          await write('enrollment_tokens', token.id, { ...previous, use_count: token.use_count + 1 }, previous);
        }
        await write('enrollment_receipts', receiptId, { ...pending, status: 'committed', token_use_consumed: true }, pending);
        const auditId = randomUUID(); journal.push(() => audit.remove(auditId));
        await audit.record(auditId, event);
        return response;
      } catch {
        let recoveryRequired = false;
        for (const undo of journal.reverse()) {
          try { await undo(); } catch { recoveryRequired = true; }
        }
        if (recoveryRequired) poisonedTokens.add(tokenHash);
        try { await audit.record(randomUUID(), { ...event, result: 'failure', recoveryRequired }); } catch { /* Best effort only. */ }
        throw new EnrollmentError();
      }
    });
  }

  return (input, sourceIp) => {
    const parsed = EnrollRequestSchema.safeParse(input);
    if (!parsed.success) return Promise.reject(new EnrollmentError('ENROLLMENT_DENIED'));
    const request = { ...parsed.data, deviceUuid: parsed.data.deviceUuid.toLowerCase() };
    const tokenHash = hashToken(request.enrollmentToken);
    const flightKey = enrollmentId(tokenHash, JSON.stringify(request));
    const existing = flights.get(flightKey); if (existing) return existing;
    if (flights.size >= 1000 || poisonedTokens.size >= 1000 || poisonedTokens.has(tokenHash)) return Promise.reject(new EnrollmentError());
    const result = tokenQueue(tokenHash, async () => {
      if (poisonedTokens.has(tokenHash)) throw new EnrollmentError();
      try { return await execute(request, sourceIp, tokenHash); }
      catch (error) { throw error instanceof EnrollmentError ? error : new EnrollmentError(); }
    });
    flights.set(flightKey, result);
    const cleanup = () => { flights.delete(flightKey); };
    void result.then(cleanup, cleanup);
    return result;
  };
}
