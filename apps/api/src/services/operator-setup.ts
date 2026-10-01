import { randomUUID } from 'node:crypto';
import { DeviceViewSchema, CreateEnrollmentTokenRequestSchema, CreateEnrollmentTokenResponseSchema,
  EnrollmentStatusResponseSchema, ConnectDeviceResponseSchema,
  type CreateEnrollmentTokenRequest, type CreateEnrollmentTokenResponse,
  type EnrollmentStatusResponse, type ConnectDeviceResponse, type DeviceView } from '@appremoto/contracts';
import type { AuthenticatedTechnician } from '../plugins/technician-auth.ts';
import type { EnrollmentData, EnrollmentRepository } from '../repositories/enrollment.ts';
import type { OperatorAuditRepository } from '../repositories/audit.ts';
import type { SetupReceiptRepository } from '../repositories/operator-setup.ts';
import { issueToken, hashToken } from '../security/tokens.ts';
import { decryptPassword } from '../security/credentials.ts';

export class OperatorSetupDenied extends Error {}
export interface OperatorSetupService {
  create(technician: AuthenticatedTechnician, request: CreateEnrollmentTokenRequest, sourceIp: string): Promise<CreateEnrollmentTokenResponse>;
  status(technician: AuthenticatedTechnician, enrollmentId: string): Promise<EnrollmentStatusResponse>;
  connect(technician: AuthenticatedTechnician, deviceId: string, sourceIp: string): Promise<ConnectDeviceResponse>;
}
interface Dependencies {
  repository: EnrollmentRepository;
  receipts: SetupReceiptRepository;
  audit: OperatorAuditRepository;
  encryptionKey: Buffer;
  keyVersion: number;
  now?: () => Date;
}
const denied = () => new OperatorSetupDenied('Access denied');
const unavailable = () => new Error('Setup unavailable');

export function createOperatorSetupService(deps: Dependencies): OperatorSetupService {
  const repo = deps.repository; const now = deps.now ?? (() => new Date());
  async function authorize(technician: AuthenticatedTechnician, organizationId: unknown,
    permission: 'canConnect' | 'canManageDevices') {
    const organization = technician.organizations.find((item) => item.id === organizationId && item.active);
    if (!organization || !technician.authorization.some((item) => item.organizationId === organizationId && item[permission]) ||
      !await repo.organizationActive(organization.id)) throw denied();
    return organization;
  }
  function view(id: string, device: EnrollmentData, name: string): DeviceView {
    const age = typeof device.last_seen_at === 'string' ? now().getTime() - Date.parse(device.last_seen_at) : NaN;
    return DeviceViewSchema.parse({ id, organizationId: device.organization_id, organizationName: name,
      deviceUuid: device.device_uuid, displayName: device.display_name, hostname: device.hostname,
      operatingSystem: device.operating_system, osVersion: device.os_version, rustdeskId: device.rustdesk_id,
      agentVersion: device.agent_version ?? null, rustdeskVersion: device.rustdesk_version ?? null,
      lastSeenAt: device.last_seen_at ?? null, enabled: device.enabled,
      status: device.enabled === true && age >= 0 && age <= 90_000 ? 'ONLINE' : 'OFFLINE' });
  }
  async function heartbeatConfirmed(deviceId: string, device: EnrollmentData): Promise<boolean> {
    const token = await repo.snapshot('device_tokens', deviceId);
    return Boolean(token && token.device_id === deviceId && token.revoked_at === null &&
      typeof token.last_used_at === 'string' && Number.isFinite(Date.parse(token.last_used_at)) &&
      token.last_used_at === device.last_seen_at && !await deps.receipts.heartbeatPending(deviceId));
  }
  return {
    async create(technician, input, sourceIp) {
      const request = CreateEnrollmentTokenRequestSchema.parse(input);
      await authorize(technician, request.organizationId, 'canManageDevices');
      const enrollmentId = randomUUID(); const enrollmentToken = issueToken();
      const expiresAt = new Date(now().getTime() + 30 * 60_000).toISOString();
      // Display name travels in the installer overlay and existing agent enrollment request.
      // No new persistence field and no lookup by display name.
      await repo.write('enrollment_tokens', enrollmentId, { organization_id: request.organizationId,
        token_hash: hashToken(enrollmentToken), expires_at: expiresAt, max_uses: 1, use_count: 0,
        active: true, created_by_user_id: technician.userId, revoked_at: null }, null);
      await deps.audit.recordOperator(randomUUID(), { organizationId: request.organizationId,
        actorId: technician.userId, enrollmentId, sourceIp, action: 'enrollment.create' });
      return CreateEnrollmentTokenResponseSchema.parse({ enrollmentId, enrollmentToken, expiresAt });
    },
    async status(technician, enrollmentId) {
      const token = await repo.snapshot('enrollment_tokens', enrollmentId);
      if (!token) throw denied();
      const organization = await authorize(technician, token.organization_id, 'canManageDevices');
      const receipts = await deps.receipts.committedReceipts(enrollmentId);
      if (receipts.length > 1) throw unavailable();
      const waiting = () => EnrollmentStatusResponseSchema.parse({ status: 'waiting', expiresAt: token.expires_at, device: null });
      const receipt = receipts[0];
      if (!receipt) return waiting();
      if (receipt.organization_id !== organization.id || receipt.enrollment_token_id !== enrollmentId ||
        receipt.status !== 'committed' || receipt.token_use_consumed !== true || receipt.recovery_frozen !== false ||
        typeof receipt.device_id !== 'string' || receipt.expected_use_count !== 1 || token.max_uses !== 1 || token.use_count !== 1) throw unavailable();
      const device = await repo.snapshot('devices', receipt.device_id);
      if (!device || device.organization_id !== organization.id || device.device_uuid !== receipt.device_uuid) throw unavailable();
      const projected = view(receipt.device_id, device, organization.name);
      if (!await heartbeatConfirmed(receipt.device_id, device)) return waiting();
      return EnrollmentStatusResponseSchema.parse({ status: projected.status.toLowerCase(), expiresAt: token.expires_at, device: projected });
    },
    async connect(technician, deviceId, sourceIp) {
      const device = await repo.snapshot('devices', deviceId);
      if (!device) throw denied();
      const organization = await authorize(technician, device.organization_id, 'canConnect');
      if (view(deviceId, device, organization.name).status !== 'ONLINE' || typeof device.rustdesk_id !== 'string' ||
        !/^[0-9]{6,16}$/.test(device.rustdesk_id) || !await heartbeatConfirmed(deviceId, device)) throw denied();
      const credential = await repo.snapshot('device_credentials', deviceId);
      if (!credential || credential.device_id !== deviceId) throw unavailable();
      let response: ConnectDeviceResponse;
      try {
        const password = decryptPassword({ passwordCiphertext: credential.password_ciphertext,
          passwordNonce: credential.password_nonce, passwordTag: credential.password_tag,
          keyVersion: credential.key_version }, deps.encryptionKey, deps.keyVersion);
        // RustDesk 1.4.9 flutter/lib/common.dart parseUriArgs + src/client.rs LoginConfigHandler::initialize.
        // Only the privileged transient response contains the credential-bearing URI; never log it.
        const key = '6qc86QUPst9+H4QjXyQvSLPbGU6ef25iO+ESoi3figk=';
        response = ConnectDeviceResponseSchema.parse({ launchUri: `rustdesk://connect/${device.rustdesk_id}@179.199.142.157:21116?key=${encodeURIComponent(key)}&password=${encodeURIComponent(password)}` });
      } catch { throw unavailable(); }
      // Record success only for a validated launch, and never release it before durable audit confirmation.
      await deps.audit.recordOperator(randomUUID(), { organizationId: organization.id, actorId: technician.userId,
        deviceId, sourceIp, action: 'device.connect' });
      return response;
    },
  };
}
