import type { HeartbeatRequest, HeartbeatResponse } from '@appremoto/contracts';
import { HeartbeatRequestSchema } from '@appremoto/contracts';
import { randomUUID } from 'node:crypto';
import { enrollmentId, IndeterminateEnrollmentWrite, sameEnrollmentState,
  type EnrollmentData, type EnrollmentRepository,
  type HeartbeatTokenRepository } from '../repositories/enrollment.ts';
import type { HeartbeatAuditRepository } from '../repositories/audit.ts';

export class HeartbeatError extends Error {
  readonly code: 'UNAUTHENTICATED' | 'HEARTBEAT_FORBIDDEN' | 'HEARTBEAT_UNAVAILABLE';
  readonly recoveryRequired: boolean;
  constructor(code: 'UNAUTHENTICATED' | 'HEARTBEAT_FORBIDDEN' | 'HEARTBEAT_UNAVAILABLE', recoveryRequired = false) {
    super(code);
    this.code = code;
    this.recoveryRequired = recoveryRequired;
  }
}

export type RecordHeartbeat = (tokenHash: string, request: HeartbeatRequest, sourceIp: string) => Promise<HeartbeatResponse>;

export interface HeartbeatDependencies {
  repository: HeartbeatTokenRepository & Pick<EnrollmentRepository, 'snapshot' | 'write' | 'restore'>;
  audit: HeartbeatAuditRepository;
  now?: () => Date;
}

export function createHeartbeatService(dependencies: HeartbeatDependencies): RecordHeartbeat {
  const { repository, audit } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  // The queue is process-local; deployment must keep one API replica until storage supports CAS.
  const tails = new Map<string, Promise<unknown>>();
  const poisoned = new Set<string>();

  return async (hash, input, sourceIp) => {
    const request = HeartbeatRequestSchema.safeParse(input);
    if (!request.success || !/^[a-f0-9]{64}$/.test(hash)) throw new HeartbeatError('UNAUTHENTICATED');
    let projection: Awaited<ReturnType<typeof repository.findDeviceToken>>;
    try { projection = await repository.findDeviceToken(hash); }
    catch { throw new HeartbeatError('HEARTBEAT_UNAVAILABLE'); }
    if (!projection || projection.token_hash !== hash || projection.revoked_at !== null ||
        projection.device_id !== projection.id || !projection.id) throw new HeartbeatError('UNAUTHENTICATED');
    const deviceId = projection.id;
    if (poisoned.has(deviceId) || tails.size >= 10_000 && !tails.has(deviceId)) {
      throw new HeartbeatError('HEARTBEAT_UNAVAILABLE', poisoned.has(deviceId));
    }
    const previous = tails.get(deviceId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async (): Promise<HeartbeatResponse> => {
      if (poisoned.has(deviceId)) throw new HeartbeatError('HEARTBEAT_UNAVAILABLE', true);
      let timestamp: string;
      try { timestamp = now().toISOString(); }
      catch { throw new HeartbeatError('HEARTBEAT_UNAVAILABLE'); }
      const guard = { deviceId, deviceTokenId: projection.id, startedAt: timestamp };
      let guarded = false;
      try { guarded = await repository.beginHeartbeatGuard(guard); }
      catch { /* A failed or uncertain create must never admit heartbeat writes. */ }
      if (!guarded) throw new HeartbeatError('HEARTBEAT_UNAVAILABLE', true);
      async function releaseGuard() {
        let released = false;
        try { released = await repository.endHeartbeatGuard(guard); }
        catch { /* A missing confirmation leaves the guard in recovery. */ }
        if (!released) throw new HeartbeatError('HEARTBEAT_UNAVAILABLE', true);
      }
      let device: EnrollmentData | null; let token: EnrollmentData | null;
      try { [device, token] = await Promise.all([
        repository.snapshot('devices', deviceId), repository.snapshot('device_tokens', deviceId),
      ]); } catch {
        await releaseGuard();
        throw new HeartbeatError('HEARTBEAT_UNAVAILABLE');
      }
      if (!device || !token || token.device_id !== deviceId || token.token_hash !== hash ||
          token.revoked_at !== null || device.enabled !== true || typeof device.organization_id !== 'string' ||
          !device.organization_id) {
        await releaseGuard();
        throw new HeartbeatError('UNAUTHENTICATED');
      }
      const updatedDevice = { ...device, operating_system: request.data.operatingSystem,
        os_version: request.data.osVersion, agent_version: request.data.agentVersion,
        rustdesk_id: request.data.rustdeskId, rustdesk_version: request.data.rustdeskVersion,
        last_seen_at: timestamp, last_ip: sourceIp };
      const updatedToken = { ...token, last_used_at: timestamp };
      const event = { organizationId: device.organization_id, deviceId, sourceIp,
        result: 'success' as const, recoveryRequired: false };
      const undo: Array<() => Promise<void>> = [];
      async function failureAudit(recoveryRequired: boolean) {
        try { await audit.recordHeartbeat(randomUUID(), { ...event, result: 'failure', recoveryRequired }); }
        catch { /* The public error remains generic when audit storage is unavailable. */ }
      }
      async function freezeAndFail(): Promise<never> {
        poisoned.add(deviceId);
        try { await repository.freezeHeartbeat(deviceId, hash, timestamp); }
        catch { /* Manual recovery is required when the durable freeze cannot be verified. */ }
        await failureAudit(true);
        throw new HeartbeatError('HEARTBEAT_UNAVAILABLE', true);
      }
      try {
        undo.push(() => repository.restore('devices', deviceId, device, updatedDevice));
        await repository.write('devices', deviceId, updatedDevice, device);
        undo.push(() => repository.restore('device_tokens', deviceId, token, updatedToken));
        await repository.write('device_tokens', deviceId, updatedToken, token);
        const [confirmedDevice, confirmedToken] = await Promise.all([
          repository.snapshot('devices', deviceId), repository.snapshot('device_tokens', deviceId),
        ]);
        if (!sameEnrollmentState('devices', confirmedDevice, updatedDevice) ||
            !sameEnrollmentState('device_tokens', confirmedToken, updatedToken)) throw new Error('Heartbeat not confirmed');
      } catch (error) {
        if (error instanceof IndeterminateEnrollmentWrite) return freezeAndFail();
        let restoreFailed = false;
        for (const restore of undo.reverse()) {
          try { await restore(); } catch { restoreFailed = true; }
        }
        if (restoreFailed) return freezeAndFail();
        await failureAudit(false);
        await releaseGuard();
        throw new HeartbeatError('HEARTBEAT_UNAVAILABLE');
      }
      const auditId = enrollmentId('heartbeat', deviceId, timestamp, hash, JSON.stringify(request.data), sourceIp);
      try { await audit.recordHeartbeat(auditId, event); }
      catch { throw new HeartbeatError('HEARTBEAT_UNAVAILABLE', true); }
      await releaseGuard();
      return { deviceId, lastSeenAt: timestamp };
    });
    tails.set(deviceId, operation);
    const cleanup = () => { if (tails.get(deviceId) === operation) tails.delete(deviceId); };
    void operation.then(cleanup, cleanup);
    return operation;
  };
}
