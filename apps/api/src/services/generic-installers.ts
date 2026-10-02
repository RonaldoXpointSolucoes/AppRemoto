import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { CreateGenericInstallerRequestSchema, CreateGenericInstallerResponseSchema, GenericInstallerViewSchema,
  GenericInstallerPackageResponseSchema, GenericInstallerListResponseSchema, PrepareInstallationRequestSchema,
  PrepareInstallationResponseSchema, type CreateGenericInstallerRequest, type CreateGenericInstallerResponse,
  type GenericInstallerView, type GenericInstallerPackageResponse, type GenericInstallerListResponse,
  type PrepareInstallationRequest, type PrepareInstallationResponse } from '@appremoto/contracts';
import type { AuthenticatedTechnician } from '../plugins/technician-auth.ts';
import type { GenericInstallerRepository, GenericInstallerRecord } from '../repositories/generic-installers.ts';
import { enrollmentId, type EnrollmentRepository, type EnrollmentToken } from '../repositories/enrollment.ts';
import type { Organization } from '../repositories/organizations.ts';
import type { OperatorAuditRepository } from '../repositories/audit.ts';
import { hashToken } from '../security/tokens.ts';

export class GenericInstallerError extends Error {
  readonly code: 'GENERIC_INSTALLER_DENIED' | 'GENERIC_INSTALLER_UNAVAILABLE' | 'GENERIC_INSTALLER_REQUEST_CONFLICT' |
    'GENERIC_INSTALLER_EXPIRED' | 'ORGANIZATION_CONFLICT' | 'PASSWORD_NOT_CONFIGURED';
  readonly statusCode: 403 | 409 | 503;
  constructor(code: GenericInstallerError['code'], statusCode: GenericInstallerError['statusCode'] = 503) {
    super(code); this.code = code; this.statusCode = statusCode;
  }
}
export interface GenericInstallerService {
  list(technician: AuthenticatedTechnician): Promise<GenericInstallerListResponse>;
  create(technician: AuthenticatedTechnician, input: CreateGenericInstallerRequest): Promise<CreateGenericInstallerResponse>;
  download(technician: AuthenticatedTechnician, id: string): Promise<GenericInstallerPackageResponse>;
  revoke(technician: AuthenticatedTechnician, id: string): Promise<{ revoked: true }>;
  prepare(capability: string, input: PrepareInstallationRequest, sourceIp: string): Promise<PrepareInstallationResponse>;
  enrollmentPassword(token: EnrollmentToken, resumePending?: boolean): Promise<string | undefined>;
}
interface Dependencies {
  repository: GenericInstallerRepository; enrollment: EnrollmentRepository; audit: OperatorAuditRepository;
  encryptionKey: Buffer; sharedPassword?: string; now?: () => Date;
}
export function normalizeCompanyName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}
const denied = () => new GenericInstallerError('GENERIC_INSTALLER_DENIED', 403);
const conflict = () => new GenericInstallerError('GENERIC_INSTALLER_REQUEST_CONFLICT', 409);
export function createGenericInstallerService(deps: Dependencies): GenericInstallerService {
  const { repository: repo, enrollment } = deps; const now = deps.now ?? (() => new Date());
  const tails = new Map<string, Promise<unknown>>();
  async function serial<T>(key: string, run: () => Promise<T>): Promise<T> {
    if (tails.size >= 1000 && !tails.has(key)) throw new GenericInstallerError('GENERIC_INSTALLER_UNAVAILABLE');
    const prior = tails.get(key) ?? Promise.resolve(); const task = prior.catch(() => undefined).then(run);
    tails.set(key, task);
    try { return await task; } finally { if (tails.get(key) === task) tails.delete(key); }
  }
  function secret(domain: string, values: string[]): string {
    return createHmac('sha256', deps.encryptionKey).update(`appremoto:${domain}:v1\0`).update(JSON.stringify(values)).digest('base64url');
  }
  function configuredPassword(): string {
    if (!deps.sharedPassword) throw new GenericInstallerError('PASSWORD_NOT_CONFIGURED');
    return deps.sharedPassword;
  }
  function superAdmin(technician: AuthenticatedTechnician) { if (technician.globalRole !== 'super_admin') throw denied(); }
  async function activeProfile(id: string, capability?: string): Promise<GenericInstallerRecord> {
    const row = await repo.get(id);
    if (!row || !row.active || row.revokedAt !== null || !await repo.issuerIsSuperAdmin(row.createdByUserId)) throw denied();
    const expected = hashToken(secret('generic-installer-capability', [row.id]));
    if (expected !== row.tokenHash || capability !== undefined &&
        (!/^[A-Za-z0-9_-]{43}$/.test(capability) || !timingSafeEqual(Buffer.from(hashToken(capability), 'hex'), Buffer.from(row.tokenHash, 'hex')))) throw denied();
    return row;
  }
  function view(row: GenericInstallerRecord): GenericInstallerView {
    return GenericInstallerViewSchema.parse({ id: row.id, name: row.name, active: row.active && row.revokedAt === null,
      createdAt: row.createdAt, revokedAt: row.revokedAt });
  }
  function packageResponse(row: GenericInstallerRecord): GenericInstallerPackageResponse {
    return GenericInstallerPackageResponseSchema.parse({ package: { schemaVersion: 2, installerId: row.id,
      installerToken: secret('generic-installer-capability', [row.id]) } });
  }
  async function resolveOrganization(request: PrepareInstallationRequest): Promise<Organization> {
    const canonical = normalizeCompanyName(request.companyName);
    if (request.existingOrganizationId) {
      const existing = await repo.organization(request.existingOrganizationId);
      if (!existing || !existing.active || normalizeCompanyName(existing.name) !== canonical) throw new GenericInstallerError('ORGANIZATION_CONFLICT', 409);
      return existing;
    }
    const matching = (await repo.organizations()).filter((value) => normalizeCompanyName(value.name) === canonical);
    if (matching.length > 1 || matching[0]?.active === false) throw new GenericInstallerError('ORGANIZATION_CONFLICT', 409);
    if (matching.length === 1) return matching[0]!;
    const id = enrollmentId('generic-organization', canonical);
    const created = { id, name: request.companyName.normalize('NFKC').trim().replace(/\s+/gu, ' '),
      slug: `client-${createHash('sha256').update(canonical).digest('hex').slice(0, 32)}`, active: true };
    await repo.createOrganization(created);
    return created;
  }
  return {
    async list(technician) { superAdmin(technician); return GenericInstallerListResponseSchema.parse({ installers: (await repo.list()).map(view) }); },
    async create(technician, input) {
      superAdmin(technician); configuredPassword(); const request = CreateGenericInstallerRequestSchema.parse(input);
      const id = randomUUID(); const row = await repo.create({ id, name: request.name,
        tokenHash: hashToken(secret('generic-installer-capability', [id])), active: true, createdByUserId: technician.userId, revokedAt: null });
      return CreateGenericInstallerResponseSchema.parse({ installer: view(row), ...packageResponse(row) });
    },
    async download(technician, id) { superAdmin(technician); configuredPassword(); return packageResponse(await activeProfile(id)); },
    async revoke(technician, id) {
      superAdmin(technician); await serial(`profile/${id}`, async () => {
        if (!await repo.get(id)) throw denied(); await repo.revoke(id, now().toISOString());
      }); return { revoked: true };
    },
    async prepare(capability, input, sourceIp) {
      const request = PrepareInstallationRequestSchema.parse(input); configuredPassword();
      await activeProfile(request.installerId, capability);
      const tokenId = enrollmentId('generic-package', request.installerId, request.requestId);
      const requestHash = hashToken(secret('generic-request', [request.installerId, request.requestId, request.requestSecret,
        normalizeCompanyName(request.companyName), request.deviceDisplayName, request.existingOrganizationId ?? '']));
      const enrollmentToken = secret('generic-enrollment-token', [request.installerId, tokenId, requestHash]);
      return serial(`profile/${request.installerId}`, () => serial(`company/${normalizeCompanyName(request.companyName)}`, async () => {
        const profile = await activeProfile(request.installerId, capability);
        let token = await enrollment.snapshot('enrollment_tokens', tokenId);
        let organization: Organization;
        if (token) {
          if (token.generic_installer_id !== profile.id || token.bootstrap_request_hash !== requestHash || token.token_hash !== hashToken(enrollmentToken)) throw conflict();
          if (token.revoked_at !== null || token.active !== true) throw denied();
          if (typeof token.expires_at !== 'string' || Date.parse(token.expires_at) <= now().getTime()) throw new GenericInstallerError('GENERIC_INSTALLER_EXPIRED', 409);
          const existing = typeof token.organization_id === 'string' ? await repo.organization(token.organization_id) : null;
          if (!existing || !existing.active) throw denied(); organization = existing;
        } else {
          organization = await resolveOrganization(request);
          token = { organization_id: organization.id, token_hash: hashToken(enrollmentToken),
            expires_at: new Date(now().getTime() + 30 * 60_000).toISOString(), max_uses: 1, use_count: 0,
            active: true, created_by_user_id: profile.createdByUserId, revoked_at: null,
            generic_installer_id: profile.id, bootstrap_request_hash: requestHash };
          await enrollment.write('enrollment_tokens', tokenId, token, null);
          const confirmed = await enrollment.snapshot('enrollment_tokens', tokenId);
          if (!confirmed || Object.entries(token).some(([key, value]) => confirmed[key] !== value)) throw new GenericInstallerError('GENERIC_INSTALLER_UNAVAILABLE');
        }
        await deps.audit.recordOperator(randomUUID(), { organizationId: organization.id,
          actorId: profile.id, actorType: 'system', enrollmentId: tokenId, sourceIp, action: 'installation.prepare' });
        await activeProfile(profile.id, capability);
        return PrepareInstallationResponseSchema.parse({ schemaVersion: 1, enrollmentId: tokenId, enrollmentToken,
          expiresAt: token.expires_at, organizationId: organization.id, organizationName: organization.name, deviceDisplayName: request.deviceDisplayName });
      }));
    },
    async enrollmentPassword(token, resumePending = false) {
      if (token.generic_installer_id == null && token.bootstrap_request_hash == null) return undefined;
      if (typeof token.generic_installer_id !== 'string' || typeof token.bootstrap_request_hash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(token.bootstrap_request_hash)) throw denied();
      if (resumePending) {
        // Finishing a rotation already authorized and durably bound to a device cannot be stranded by profile revocation.
        if (!await repo.get(token.generic_installer_id)) throw denied();
      } else await activeProfile(token.generic_installer_id);
      return configuredPassword();
    },
  };
}
