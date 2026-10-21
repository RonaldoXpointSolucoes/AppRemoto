import type { DataDivasInfo, HeartbeatPendingCommand, HeartbeatRequest, HeartbeatResponse } from '@appremoto/contracts';
import { HeartbeatRequestSchema, SafeRemoteCommandActionSchema, extractDataDivasFromNotes, mergeDataDivasIntoNotes, normalizeWindowsHostname } from '@appremoto/contracts';
import { randomUUID } from 'node:crypto';
import { enrollmentId, IndeterminateEnrollmentWrite, sameEnrollmentState,
  type EnrollmentData, type EnrollmentRepository,
  type HeartbeatTokenRepository } from '../repositories/enrollment.ts';
import type { HeartbeatAuditRepository } from '../repositories/audit.ts';

const TELEMETRY_SOFT_THROTTLE_MS = 180_000;
const COMMAND_TTL_MS = 10 * 60_000;

const STRUCTURAL_DATADIVAS_KEYS: (keyof DataDivasInfo)[] = [
  'nomeFantasia', 'razaoSocial', 'cnpj', 'serial', 'ie', 'endereco', 'cidade', 'uf',
  'nomeMaq', 'ipMaq', 'ipDataDivas', 'banco', 'funcao',
  'windowsHostnameDesejado', 'statusRenomeacao', 'erroRenomeacao',
  'reservaId', 'substituiuDeviceId',
  'cpuModelo', 'ramTotalGb', 'discoTotalGb',
  'redeSubrede', 'redeGateway', 'redeTipo',
  'comandoPendente', 'comandoId', 'comandoSolicitadoEm', 'comandoStatus', 'comandoResultado',
];

function supportsRemoteCommands(agentVersion: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(agentVersion.trim());
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (major !== 1) return major > 1;
  if (minor !== 6) return minor > 6;
  return patch >= 4;
}

function hasSignificantUsageDelta(prevValue?: string, nextValue?: string, threshold = 10): boolean {
  if (!nextValue) return false;
  if (!prevValue) return true;
  const prevNum = Number(prevValue);
  const nextNum = Number(nextValue);
  if (!Number.isFinite(prevNum) || !Number.isFinite(nextNum)) return prevValue !== nextValue;
  return Math.abs(nextNum - prevNum) >= threshold;
}

export function shouldPersistDataDivasUpdate(
  existing: DataDivasInfo | null,
  candidate: DataDivasInfo,
  nowIso: string,
): boolean {
  if (!existing) return true;
  for (const key of STRUCTURAL_DATADIVAS_KEYS) {
    if (candidate[key] !== undefined && candidate[key] !== (existing[key] ?? '')) {
      if (candidate[key] === '' && existing[key] === undefined) continue;
      return true;
    }
  }
  if (
    hasSignificantUsageDelta(existing.cpuUsoPct, candidate.cpuUsoPct, 10) ||
    hasSignificantUsageDelta(existing.ramUsoPct, candidate.ramUsoPct, 10) ||
    hasSignificantUsageDelta(existing.discoUsoPct, candidate.discoUsoPct, 5)
  ) {
    return true;
  }
  const lastSyncMs = existing.ultimaSincronizacao ? Date.parse(existing.ultimaSincronizacao) : NaN;
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(lastSyncMs) || !Number.isFinite(nowMs)) return true;
  return nowMs - lastSyncMs >= TELEMETRY_SOFT_THROTTLE_MS;
}

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
    const poisonKey = `${deviceId}:${hash}`;
    if (poisoned.has(poisonKey) || tails.size >= 10_000 && !tails.has(deviceId)) {
      throw new HeartbeatError('HEARTBEAT_UNAVAILABLE', poisoned.has(poisonKey));
    }
    const previous = tails.get(deviceId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async (): Promise<HeartbeatResponse> => {
      if (poisoned.has(poisonKey)) throw new HeartbeatError('HEARTBEAT_UNAVAILABLE', true);
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
      const existingDataDivas = extractDataDivasFromNotes(typeof device.notes === 'string' ? device.notes : null).datadivas;
      const incomingHost = request.data.hostname || request.data.datadivas?.nomeMaq || (typeof device.hostname === 'string' ? device.hostname : '');
      const desiredHost = request.data.datadivas?.windowsHostnameDesejado || existingDataDivas?.windowsHostnameDesejado || (typeof device.display_name === 'string' ? device.display_name : '');
      const normActual = normalizeWindowsHostname(incomingHost);
      const normDesired = normalizeWindowsHostname(desiredHost);
      let nextRenameStatus = request.data.datadivas?.statusRenomeacao || existingDataDivas?.statusRenomeacao;
      if (normActual && normDesired) {
        if ((nextRenameStatus === 'APLICADO_AGUARDANDO_REBOOT' || nextRenameStatus === 'RESERVADO' || nextRenameStatus === 'DIVERGENTE') && normActual === normDesired) {
          nextRenameStatus = 'CONFIRMADO';
        } else if (nextRenameStatus === 'CONFIRMADO' && normActual !== normDesired) {
          nextRenameStatus = 'DIVERGENTE';
        }
      }

      let pendingCommandToDeliver: HeartbeatPendingCommand | undefined;
      let commandPatch: Partial<DataDivasInfo> = {};
      const incomingCmdId = request.data.datadivas?.comandoId;
      const incomingCmdStatus = request.data.datadivas?.comandoStatus;

      if (incomingCmdId && existingDataDivas?.comandoId === incomingCmdId && incomingCmdStatus) {
        commandPatch = {
          comandoPendente: '',
          comandoStatus: incomingCmdStatus,
          ...(request.data.datadivas?.comandoResultado ? { comandoResultado: request.data.datadivas.comandoResultado } : {}),
        };
      } else if (existingDataDivas?.comandoPendente && existingDataDivas.comandoStatus === 'PENDENTE') {
        const parsedAction = SafeRemoteCommandActionSchema.safeParse(existingDataDivas.comandoPendente);
        const requestedMs = existingDataDivas.comandoSolicitadoEm ? Date.parse(existingDataDivas.comandoSolicitadoEm) : NaN;
        const nowMs = Date.parse(timestamp);
        const isExpired = Number.isFinite(requestedMs) && Number.isFinite(nowMs) && (nowMs - requestedMs > COMMAND_TTL_MS);

        if (!parsedAction.success || isExpired) {
          commandPatch = {
            comandoPendente: '',
            comandoStatus: isExpired ? 'EXPIRADO' : 'REJEITADO',
            comandoResultado: isExpired ? 'Comando expirou (limite de 10 min sem recepção)' : 'Ação não permitida',
          };
        } else if (parsedAction.data === 'SYNC_TELEMETRY') {
          if (supportsRemoteCommands(request.data.agentVersion)) {
            pendingCommandToDeliver = {
              id: existingDataDivas.comandoId || randomUUID(),
              action: 'SYNC_TELEMETRY',
              requestedAt: existingDataDivas.comandoSolicitadoEm || timestamp,
            };
          }
          commandPatch = {
            comandoPendente: '',
            comandoStatus: 'EXECUTADO',
            comandoResultado: `Leitura sincronizada às ${timestamp.slice(11, 19)} UTC`,
          };
        } else if (supportsRemoteCommands(request.data.agentVersion)) {
          pendingCommandToDeliver = {
            id: existingDataDivas.comandoId || randomUUID(),
            action: parsedAction.data,
            requestedAt: existingDataDivas.comandoSolicitadoEm || timestamp,
          };
          commandPatch = {
            comandoPendente: '',
            comandoStatus: 'ENTREGUE_AGENTE',
            comandoResultado: 'Comando entregue ao agente Windows para execução imediata',
          };
        } else {
          commandPatch = {
            comandoPendente: '',
            comandoStatus: 'DISPONIVEL_TERMINAL',
            comandoResultado: `Agente v${request.data.agentVersion}: use Copiar Comando Rápido para executar no RustDesk`,
          };
        }
      }

      const enrichedDataDivas: DataDivasInfo | undefined = (request.data.datadivas || existingDataDivas)
        ? {
            ...(request.data.datadivas ?? {}),
            ...(nextRenameStatus ? { statusRenomeacao: nextRenameStatus } : {}),
            ...commandPatch,
            ultimaSincronizacao: timestamp,
          }
        : undefined;
      const shouldWriteNotes = enrichedDataDivas
        ? shouldPersistDataDivasUpdate(existingDataDivas, enrichedDataDivas, timestamp)
        : false;
      const nextNotes = (enrichedDataDivas && shouldWriteNotes)
        ? mergeDataDivasIntoNotes(typeof device.notes === 'string' ? device.notes : null, enrichedDataDivas)
        : device.notes;
      const updatedDevice = { ...device,
        ...(request.data.hostname ? { hostname: request.data.hostname } : {}),
        operating_system: request.data.operatingSystem,
        os_version: request.data.osVersion, agent_version: request.data.agentVersion,
        rustdesk_id: request.data.rustdeskId, rustdesk_version: request.data.rustdeskVersion,
        last_seen_at: timestamp, last_ip: sourceIp,
        ...(nextNotes !== undefined ? { notes: nextNotes } : {}) };
      const updatedToken = { ...token, last_used_at: timestamp };
      const event = { organizationId: device.organization_id, deviceId, sourceIp,
        result: 'success' as const, recoveryRequired: false };
      const undo: Array<() => Promise<void>> = [];
      async function failureAudit(recoveryRequired: boolean) {
        try { await audit.recordHeartbeat(randomUUID(), { ...event, result: 'failure', recoveryRequired }); }
        catch { /* The public error remains generic when audit storage is unavailable. */ }
      }
      async function freezeAndFail(): Promise<never> {
        poisoned.add(poisonKey);
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
      return {
        deviceId,
        lastSeenAt: timestamp,
        ...(pendingCommandToDeliver ? { pendingCommand: pendingCommandToDeliver } : {}),
      };
    });
    tails.set(deviceId, operation);
    const cleanup = () => { if (tails.get(deviceId) === operation) tails.delete(deviceId); };
    void operation.then(cleanup, cleanup);
    return operation;
  };
}
