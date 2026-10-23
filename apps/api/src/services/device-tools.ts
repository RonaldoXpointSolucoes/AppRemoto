import { randomUUID } from 'node:crypto';
import { DeviceDetailsResponseSchema, UpdateDeviceRequestSchema, UpdateDeviceResponseSchema, ConnectionEventRequestSchema,
  ConnectionHistoryResponseSchema, DeviceViewSchema, DeleteDeviceResponseSchema, extractDataDivasFromNotes, mergeDataDivasIntoNotes, extractDeviceAccessPolicy,
  type DeviceDetailsResponse, type UpdateDeviceRequest, type UpdateDeviceResponse, type ConnectionEventInput, type ConnectionHistoryResponse,
  type ConnectionHistoryEvent, type DeviceView, type DeleteDeviceResponse } from '@appremoto/contracts';
import type { AuthenticatedTechnician } from '../plugins/technician-auth.ts';
import { enrollmentId, IndeterminateEnrollmentWrite, type EnrollmentData, type EnrollmentRepository,
  type HeartbeatTokenRepository } from '../repositories/enrollment.ts';
import type { OperatorAuditRepository } from '../repositories/audit.ts';
import type { SetupReceiptRepository } from '../repositories/operator-setup.ts';
import { OperatorSetupDenied, DeviceToolError } from './operator-errors.ts';

export interface DeviceToolsService {
  details(technician: AuthenticatedTechnician, deviceId: string): Promise<DeviceDetailsResponse>;
  update(technician: AuthenticatedTechnician, deviceId: string, request: UpdateDeviceRequest, sourceIp: string): Promise<UpdateDeviceResponse>;
  delete(technician: AuthenticatedTechnician, deviceId: string, sourceIp: string): Promise<DeleteDeviceResponse>;
  connectionHistory(technician: AuthenticatedTechnician, deviceId: string): Promise<ConnectionHistoryResponse>;
  connectionEvent(technician: AuthenticatedTechnician, deviceId: string, request: ConnectionEventInput, sourceIp: string): Promise<{ recorded: true }>;
}
interface Dependencies {
  repository: EnrollmentRepository; receipts: SetupReceiptRepository; audit: OperatorAuditRepository;
  keyVersion: number; now?: () => Date;
  guard?: Pick<HeartbeatTokenRepository, 'beginHeartbeatGuard' | 'endHeartbeatGuard'>;
}
const denied = () => new OperatorSetupDenied('Access denied');
const unavailable = () => new DeviceToolError('CONNECT_UNAVAILABLE');
const validId = (value: unknown): value is string => typeof value === 'string' && /^[0-9]{6,16}$/.test(value);
const eventCodes = { launch_requested: 'BROWSER_LAUNCH_REQUESTED', launch_failed: 'BROWSER_LAUNCH_FAILED',
  not_opened: 'APP_NOT_OPENED', session_confirmed: 'OPERATOR_SESSION_CONFIRMED',
  session_failed: 'OPERATOR_SESSION_FAILED' } as const;

export function createDeviceTools(deps: Dependencies): DeviceToolsService {
  const { repository: repo, audit } = deps; const now = deps.now ?? (() => new Date());
  async function authorizedDevice(technician: AuthenticatedTechnician, deviceId: string,
    permission: 'canView' | 'canConnect' | 'canManageDevices') {
    const device = await repo.snapshot('devices', deviceId);
    const organization = technician.organizations.find((item) => item.id === device?.organization_id && item.active);
    if (!device || !organization || !technician.authorization.some((item) => item.organizationId === organization.id &&
        item.canView && item[permission]) || !await repo.organizationActive(organization.id)) throw denied();
    return { device, organization };
  }
  function isTechnicianAdmin(technician: AuthenticatedTechnician, organizationId: string): boolean {
    return technician.globalRole === 'super_admin' ||
      technician.authorization.some((item) => item.organizationId === organizationId && item.canView && item.role === 'admin');
  }
  function view(id: string, device: EnrollmentData, name: string): DeviceView {
    const age = typeof device.last_seen_at === 'string' ? now().getTime() - Date.parse(device.last_seen_at) : NaN;
    const { datadivas, cleanNotes } = extractDataDivasFromNotes(typeof device.notes === 'string' ? device.notes : null);
    const policy = extractDeviceAccessPolicy(cleanNotes);
    return DeviceViewSchema.parse({ id, organizationId: device.organization_id, organizationName: name,
      deviceUuid: device.device_uuid, displayName: device.display_name, hostname: device.hostname,
      operatingSystem: device.operating_system, osVersion: device.os_version, rustdeskId: device.rustdesk_id,
      agentVersion: device.agent_version ?? null, rustdeskVersion: device.rustdesk_version ?? null,
      lastSeenAt: device.last_seen_at ?? null,
      ...(typeof device.last_ip === 'string' && device.last_ip ? { publicIp: device.last_ip } : {}),
      enabled: device.enabled,
      status: device.enabled === true && age >= 0 && age <= 90_000 ? 'ONLINE' : 'OFFLINE',
      ...(datadivas ? { datadivas } : {}),
      ...(cleanNotes ? { notes: cleanNotes } : {}),
      ...(policy.requiresAccessPassword ? { requiresAccessPassword: true } : {}),
      ...(policy.adminOnlyAccess ? { adminOnlyAccess: true } : {}),
      ...(policy.customDisplayName ? { customDisplayName: true } : {}) });
  }
  async function heartbeatConfirmed(deviceId: string, device: EnrollmentData): Promise<boolean> {
    const [token, pending] = await Promise.all([
      repo.snapshot('device_tokens', deviceId),
      deps.receipts.heartbeatPending(deviceId),
    ]);
    return Boolean(token && token.device_id === deviceId && token.revoked_at === null &&
      typeof token.last_used_at === 'string' && Number.isFinite(Date.parse(token.last_used_at)) &&
      token.last_used_at === device.last_seen_at && !pending);
  }
  return {
    async details(technician, deviceId) {
      const { device, organization } = await authorizedDevice(technician, deviceId, 'canView');
      const projected = view(deviceId, device, organization.name);
      const { cleanNotes } = extractDataDivasFromNotes(typeof device.notes === 'string' ? device.notes : null);
      const canConnect = technician.authorization.some((item) => item.organizationId === organization.id && item.canConnect);
      const [credential, hbConfirmed] = await Promise.all([
        canConnect ? repo.snapshot('device_credentials', deviceId) : Promise.resolve(null),
        heartbeatConfirmed(deviceId, device),
      ]);
      return DeviceDetailsResponseSchema.parse({ device: projected, notes: cleanNotes, diagnostics: {
        agentOnline: projected.status === 'ONLINE', heartbeatConfirmed: hbConfirmed,
        rustdeskIdValid: validId(device.rustdesk_id), credentialAvailable: Boolean(credential && credential.device_id === deviceId &&
          typeof credential.password_ciphertext === 'string' && credential.password_ciphertext && credential.key_version === deps.keyVersion),
      } });
    },
    async update(technician, deviceId, input, sourceIp) {
      const request = UpdateDeviceRequestSchema.parse(input);
      const { device: initialDevice, organization: initialOrg } = await authorizedDevice(technician, deviceId, 'canManageDevices');
      const initialCleanNotes = extractDataDivasFromNotes(typeof initialDevice.notes === 'string' ? initialDevice.notes : null).cleanNotes;
      const initialPolicy = extractDeviceAccessPolicy(initialCleanNotes);
      const requestedCleanNotes = extractDataDivasFromNotes(request.notes).cleanNotes;
      const requestedPolicy = extractDeviceAccessPolicy(requestedCleanNotes);
      if ((initialPolicy.adminOnlyAccess || requestedPolicy.adminOnlyAccess) && !isTechnicianAdmin(technician, initialOrg.id)) {
        throw denied();
      }
      if (!deps.guard || !deps.receipts.updateDeviceFields) throw unavailable();
      const guard = { deviceId, deviceTokenId: deviceId, startedAt: now().toISOString() };
      if (!await deps.guard.beginHeartbeatGuard(guard)) throw new DeviceToolError('DEVICE_BUSY', 409);
      let uncertain = false;
      try {
        const { device: priorDevice, organization } = await authorizedDevice(technician, deviceId, 'canManageDevices');
        const previousDisplayName = typeof priorDevice.display_name === 'string' ? priorDevice.display_name : '';
        const priorCleanNotes = extractDataDivasFromNotes(typeof priorDevice.notes === 'string' ? priorDevice.notes : null).cleanNotes;
        const priorPolicy = extractDeviceAccessPolicy(priorCleanNotes);
        if ((priorPolicy.adminOnlyAccess || requestedPolicy.adminOnlyAccess) && !isTechnicianAdmin(technician, organization.id)) {
          throw denied();
        }
        const event = { organizationId: organization.id, actorId: technician.userId, deviceId, sourceIp };
        await audit.recordOperator(randomUUID(), { ...event, action: 'device.update.requested' });
        const existingDataDivas = extractDataDivasFromNotes(typeof priorDevice.notes === 'string' ? priorDevice.notes : null).datadivas;
        const incomingDataDivas = extractDataDivasFromNotes(request.notes).datadivas;
        const mergedDataDivas = existingDataDivas || incomingDataDivas
          ? { ...(existingDataDivas ?? {}), ...(incomingDataDivas ?? {}) }
          : null;
        const persistedNotes = mergedDataDivas
          ? (mergeDataDivasIntoNotes(request.notes, mergedDataDivas) ?? request.notes)
          : request.notes;
        await deps.receipts.updateDeviceFields(deviceId, { displayName: request.displayName, notes: persistedNotes });
        const { device } = await authorizedDevice(technician, deviceId, 'canManageDevices');
        if (device.display_name !== request.displayName || device.notes !== persistedNotes) throw unavailable();
        await audit.recordOperator(randomUUID(), {
          ...event,
          action: 'device.update',
          deviceChange: {
            previousDisplayName,
            displayName: request.displayName,
            hostname: typeof device.hostname === 'string' ? device.hostname : '',
            rustdeskId: typeof device.rustdesk_id === 'string' ? device.rustdesk_id : '',
            actorName: technician.displayName,
            adminOnlyAccess: requestedPolicy.adminOnlyAccess,
          },
        });
        const { cleanNotes } = extractDataDivasFromNotes(typeof device.notes === 'string' ? device.notes : null);
        return UpdateDeviceResponseSchema.parse({ device: view(deviceId, device, organization.name), notes: cleanNotes });
      } catch (error) {
        uncertain = error instanceof IndeterminateEnrollmentWrite;
        throw error;
      } finally {
        // An uncertain late PATCH must not race the heartbeat's consistency check.
        if (!uncertain && !await deps.guard.endHeartbeatGuard(guard)) throw unavailable();
      }
    },
    async delete(technician, deviceId, sourceIp) {
      const { device, organization } = await authorizedDevice(technician, deviceId, 'canManageDevices');
      const cleanNotes = extractDataDivasFromNotes(typeof device.notes === 'string' ? device.notes : null).cleanNotes;
      const policy = extractDeviceAccessPolicy(cleanNotes);
      if (policy.adminOnlyAccess && !isTechnicianAdmin(technician, organization.id)) {
        throw denied();
      }
      if (!deps.receipts.deleteDevice) throw unavailable();
      const event = {
        organizationId: organization.id,
        actorId: technician.userId,
        deviceId,
        sourceIp,
        deviceChange: {
          displayName: typeof device.display_name === 'string' ? device.display_name : '',
          hostname: typeof device.hostname === 'string' ? device.hostname : '',
          rustdeskId: typeof device.rustdesk_id === 'string' ? device.rustdesk_id : '',
          actorName: technician.displayName,
          adminOnlyAccess: policy.adminOnlyAccess,
        },
      };
      await audit.recordOperator(randomUUID(), { ...event, action: 'device.delete' });
      await deps.receipts.deleteDevice(deviceId);
      return DeleteDeviceResponseSchema.parse({ ok: true, deviceId });
    },
    async connectionHistory(technician, deviceId) {
      const { organization } = await authorizedDevice(technician, deviceId, 'canView');
      if (!audit.connectionHistory) throw unavailable();
      const records = await audit.connectionHistory(deviceId);
      return ConnectionHistoryResponseSchema.parse({ events: records.filter((item) => item.deviceId === deviceId &&
        item.organizationId === organization.id).slice(0, 30).map((item) => item.event) });
    },
    async connectionEvent(technician, deviceId, input, sourceIp) {
      const request = ConnectionEventRequestSchema.parse(input);
      const { organization } = await authorizedDevice(technician, deviceId, 'canConnect');
      if (!audit.connectionAttempt) throw unavailable();
      const attempt = await audit.connectionAttempt(request.attemptId);
      const age = attempt ? now().getTime() - Date.parse(attempt.event.at) : NaN;
      if (!attempt || attempt.action !== 'device.connect' || attempt.result !== 'success' ||
          attempt.organizationId !== organization.id || attempt.deviceId !== deviceId || attempt.actorId !== technician.userId ||
          attempt.event.id !== request.attemptId || attempt.event.attemptId !== request.attemptId ||
          attempt.event.mode !== request.mode || attempt.event.stage !== 'authorized' || attempt.event.source !== 'api' ||
          attempt.event.code !== 'LAUNCH_AUTHORIZED' || !Number.isFinite(age) || age < 0 || age > 30 * 60_000 ||
          request.code !== undefined && request.code !== eventCodes[request.event]) throw denied();
      const source: ConnectionHistoryEvent['source'] = ['launch_requested', 'launch_failed'].includes(request.event) ? 'browser' : 'operator';
      // One event per stage per attempt bounds retries and records self-reports explicitly.
      await audit.recordOperator(enrollmentId('connection-event', request.attemptId, request.event), {
        organizationId: organization.id, actorId: technician.userId, deviceId, sourceIp, action: 'device.connect.event',
        result: ['launch_failed', 'not_opened', 'session_failed'].includes(request.event) ? 'failure' : 'success',
        connection: { attemptId: request.attemptId, mode: request.mode, stage: request.event, code: eventCodes[request.event], source },
      });
      return { recorded: true };
    },
  };
}
