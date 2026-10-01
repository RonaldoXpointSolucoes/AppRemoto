import { ConnectDeviceRequestSchema, ConnectDeviceLaunchResponseSchema, type ConnectDeviceRequest,
  type ConnectDeviceLaunchResponse, type ConnectDeviceResponse } from '@appremoto/contracts';
import type { AuthenticatedTechnician } from '../plugins/technician-auth.ts';
import type { EnrollmentRepository } from '../repositories/enrollment.ts';
import type { OperatorAuditRepository } from '../repositories/audit.ts';
import type { SetupReceiptRepository } from '../repositories/operator-setup.ts';
import { OperatorSetupDenied, DeviceToolError } from './operator-errors.ts';

export type ConnectWithOptions = (technician: AuthenticatedTechnician, deviceId: string,
  input: ConnectDeviceRequest, sourceIp: string) => Promise<ConnectDeviceLaunchResponse>;
interface Dependencies {
  repository: EnrollmentRepository; audit: OperatorAuditRepository; receipts: SetupReceiptRepository;
  now?: () => Date;
  // Reuse the unchanged, already-authorized automatic connect implementation.
  // This wrapper never decrypts, changes or logs its launch URI.
  connectAutomatic(technician: AuthenticatedTechnician, deviceId: string, sourceIp: string): Promise<ConnectDeviceResponse>;
}

export function createConnectionLaunch(deps: Dependencies): ConnectWithOptions {
  const now = deps.now ?? (() => new Date());
  return async (technician, deviceId, input, sourceIp) => {
    const request = ConnectDeviceRequestSchema.parse(input);
    const device = await deps.repository.snapshot('devices', deviceId);
    const organization = technician.organizations.find((item) => item.id === device?.organization_id && item.active);
    const permission = technician.authorization.find((item) => item.organizationId === organization?.id);
    if (!device || !organization || !permission?.canView || !await deps.repository.organizationActive(organization.id)) {
      throw new OperatorSetupDenied('Access denied');
    }
    const base = { organizationId: organization.id, actorId: technician.userId, deviceId, sourceIp,
      action: 'device.connect' as const };
    let response: ConnectDeviceLaunchResponse;
    try {
      if (!permission.canConnect || device.enabled !== true) throw new DeviceToolError('ACCESS_DENIED', 403);
      if (typeof device.rustdesk_id !== 'string' || !/^[0-9]{6,16}$/.test(device.rustdesk_id)) {
        throw new DeviceToolError('INVALID_RUSTDESK_ID', 409);
      }
      if (request.mode === 'automatic') {
        const age = typeof device.last_seen_at === 'string' ? now().getTime() - Date.parse(device.last_seen_at) : NaN;
        if (!Number.isFinite(age) || age < 0 || age > 90_000) throw new DeviceToolError('DEVICE_OFFLINE', 409);
        const token = await deps.repository.snapshot('device_tokens', deviceId);
        if (!token || token.device_id !== deviceId || token.revoked_at !== null ||
            typeof token.last_used_at !== 'string' || token.last_used_at !== device.last_seen_at ||
            await deps.receipts.heartbeatPending(deviceId)) throw new DeviceToolError('HEARTBEAT_UNCONFIRMED', 409);
        const launch = await deps.connectAutomatic(technician, deviceId, sourceIp);
        response = ConnectDeviceLaunchResponseSchema.parse({ ...launch, ...request });
      } else {
        // Manual launch contains only public server configuration. No password is accepted or read here.
        const key = '6qc86QUPst9+H4QjXyQvSLPbGU6ef25iO+ESoi3figk=';
        response = ConnectDeviceLaunchResponseSchema.parse({ ...request,
          launchUri: `rustdesk://connect/${device.rustdesk_id}@179.199.142.157:21116?key=${encodeURIComponent(key)}` });
      }
    } catch (error) {
      const failure = error instanceof DeviceToolError ? error : new DeviceToolError('CONNECT_UNAVAILABLE');
      await deps.audit.recordOperator(request.attemptId, { ...base, result: 'failure', connection: {
        ...request, stage: 'rejected', code: failure.code === 'DEVICE_BUSY' ? 'CONNECT_UNAVAILABLE' : failure.code, source: 'api' } });
      throw failure;
    }
    await deps.audit.recordOperator(request.attemptId, { ...base, connection: {
      ...request, stage: 'authorized', code: 'LAUNCH_AUTHORIZED', source: 'api' } });
    return response;
  };
}
