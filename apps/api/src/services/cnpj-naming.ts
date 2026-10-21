import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  AdminCnpjNamingActionRequestSchema,
  COMPUTER_ROLE_CATALOG,
  CnpjCompanyGroupViewSchema,
  CnpjGroupsListResponseSchema,
  CnpjMigrationRequestSchema,
  CnpjMigrationResponseSchema,
  ComputerRoleCodeSchema,
  ConfirmNameRequestSchema,
  ConfirmNameResponseSchema,
  DeviceSyncRequestSchema,
  DeviceSyncResponseSchema,
  InstallationContextRequestSchema,
  InstallationContextResponseSchema,
  ReleaseNameRequestSchema,
  ReleaseNameResponseSchema,
  RenameStatusSchema,
  ReserveNameRequestSchema,
  ReserveNameResponseSchema,
  SuggestNameRequestSchema,
  SuggestNameResponseSchema,
  extractDataDivasFromNotes,
  formatCnpj,
  getRoleLabel,
  inferRoleFromName,
  mergeDataDivasIntoNotes,
  normalizeCnpj,
  normalizeWindowsHostname,
  suggestNameForRole,
  validateWindowsHostname,
  type AdminCnpjNamingActionRequest,
  type CatalogRoleOption,
  type CnpjCompanyGroupView,
  type CnpjGroupsListResponse,
  type CnpjMigrationAnomaly,
  type CnpjMigrationRequest,
  type CnpjMigrationResponse,
  type ComputerRoleCode,
  type ConfirmNameRequest,
  type ConfirmNameResponse,
  type DeviceSyncRequest,
  type DeviceSyncResponse,
  type ExistingCompanyComputer,
  type InstallationContextRequest,
  type InstallationContextResponse,
  type NamingHistoryEvent,
  type NamingReservationRecord,
  type ReleaseNameRequest,
  type ReleaseNameResponse,
  type RenameStatus,
  type ReserveNameRequest,
  type ReserveNameResponse,
  type SuggestNameRequest,
  type SuggestNameResponse,
} from '@appremoto/contracts';
import type { AuthenticatedTechnician } from '../plugins/technician-auth.ts';
import type { CnpjNamingRepository, RawDeviceDocument } from '../repositories/cnpj-naming.ts';
import { enrollmentId } from '../repositories/enrollment.ts';
import type { GenericInstallerRepository } from '../repositories/generic-installers.ts';
import type { Organization } from '../repositories/organizations.ts';
import { hashToken } from '../security/tokens.ts';

export class CnpjNamingError extends Error {
  readonly code:
    | 'NAMING_ACCESS_DENIED'
    | 'INVALID_CNPJ'
    | 'INVALID_HOSTNAME'
    | 'NAME_CONFLICT'
    | 'DEVICE_NOT_FOUND'
    | 'NAMING_UNAVAILABLE';
  readonly statusCode: 400 | 403 | 404 | 409 | 503;

  constructor(
    code: CnpjNamingError['code'],
    message: string,
    statusCode: CnpjNamingError['statusCode'] = 400,
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface CnpjNamingService {
  getInstallationContext(
    capability: string,
    input: InstallationContextRequest,
    sourceIp: string,
  ): Promise<InstallationContextResponse>;
  suggestName(
    capability: string | null,
    technician: AuthenticatedTechnician | null,
    input: SuggestNameRequest,
  ): Promise<SuggestNameResponse>;
  reserveName(
    capability: string,
    input: ReserveNameRequest,
    sourceIp: string,
  ): Promise<ReserveNameResponse>;
  confirmName(
    capability: string | null,
    input: ConfirmNameRequest,
    sourceIp: string,
  ): Promise<ConfirmNameResponse>;
  releaseName(
    capability: string | null,
    technician: AuthenticatedTechnician | null,
    input: ReleaseNameRequest,
    sourceIp: string,
  ): Promise<ReleaseNameResponse>;
  syncDevice(
    input: DeviceSyncRequest,
    sourceIp: string,
  ): Promise<DeviceSyncResponse>;
  listCnpjGroups(
    technician: AuthenticatedTechnician,
    cnpjFilter?: string,
  ): Promise<CnpjGroupsListResponse>;
  adminAction(
    technician: AuthenticatedTechnician,
    input: AdminCnpjNamingActionRequest,
    sourceIp: string,
  ): Promise<CnpjCompanyGroupView>;
  migrateExistingDevices(
    technician: AuthenticatedTechnician,
    input: CnpjMigrationRequest,
    sourceIp: string,
  ): Promise<CnpjMigrationResponse>;
}

export interface CnpjNamingDependencies {
  repository: CnpjNamingRepository;
  installers: GenericInstallerRepository;
  encryptionKey: Buffer;
  now?: () => Date;
}

function normalizeCompanyLabel(value?: string | null): string {
  if (!value) return '';
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

export function createCnpjNamingService(deps: CnpjNamingDependencies): CnpjNamingService {
  const { repository: repo, installers } = deps;
  const now = deps.now ?? (() => new Date());
  const tails = new Map<string, Promise<unknown>>();

  async function serial<T>(key: string, run: () => Promise<T>): Promise<T> {
    const prior = tails.get(key) ?? Promise.resolve();
    const task = prior.catch(() => undefined).then(run);
    tails.set(key, task);
    try {
      return await task;
    } finally {
      if (tails.get(key) === task) tails.delete(key);
    }
  }

  function deriveInstallerSecret(installerId: string): string {
    return createHmac('sha256', deps.encryptionKey)
      .update('appremoto:generic-installer-capability:v1\0')
      .update(JSON.stringify([installerId]))
      .digest('base64url');
  }

  async function verifyInstallerCapability(installerId: string, capability: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(capability)) {
      throw new CnpjNamingError('NAMING_ACCESS_DENIED', 'Invalid installer capability', 403);
    }
    const providedHash = hashToken(capability);
    if (installerId === 'auto') {
      const rows = await installers.list();
      const matched = rows.find((r) => r.active && r.revokedAt === null && r.tokenHash === providedHash);
      if (
        !matched ||
        hashToken(deriveInstallerSecret(matched.id)) !== matched.tokenHash ||
        !timingSafeEqual(Buffer.from(providedHash, 'hex'), Buffer.from(matched.tokenHash, 'hex')) ||
        !(await installers.issuerIsSuperAdmin(matched.createdByUserId))
      ) {
        throw new CnpjNamingError('NAMING_ACCESS_DENIED', 'Installer authorization inactive', 403);
      }
      return;
    }
    const row = await installers.get(installerId);
    if (!row || !row.active || row.revokedAt !== null || !(await installers.issuerIsSuperAdmin(row.createdByUserId))) {
      throw new CnpjNamingError('NAMING_ACCESS_DENIED', 'Installer authorization inactive', 403);
    }
    const expectedHash = hashToken(deriveInstallerSecret(row.id));
    if (
      expectedHash !== row.tokenHash ||
      !timingSafeEqual(Buffer.from(providedHash, 'hex'), Buffer.from(row.tokenHash, 'hex'))
    ) {
      throw new CnpjNamingError('NAMING_ACCESS_DENIED', 'Installer capability mismatch', 403);
    }
  }

  function reservationDocId(cnpj14: string, normalizedName: string): string {
    return enrollmentId('name-res', cnpj14, normalizedName);
  }

  function isReservationActive(res: NamingReservationRecord, currentNow: Date): boolean {
    if (res.status === 'RELEASED') return false;
    if (res.status === 'CONFIRMED' || res.status === 'AWAITING_REBOOT') return true;
    if (!res.expiresAt) return true;
    const exp = Date.parse(res.expiresAt);
    return Number.isFinite(exp) && exp > currentNow.getTime();
  }

  function resolveDeviceNamingState(
    doc: RawDeviceDocument,
    currentNow: Date,
    currentMachineUuid?: string,
  ): ExistingCompanyComputer {
    const { datadivas } = extractDataDivasFromNotes(doc.notes);
    const desiredFromMeta = datadivas?.windowsHostnameDesejado
      ? normalizeWindowsHostname(datadivas.windowsHostnameDesejado)
      : null;
    const effectiveDisplayName = normalizeWindowsHostname(doc.displayName) || normalizeWindowsHostname(doc.hostname) || doc.displayName;
    const inferred = inferRoleFromName(desiredFromMeta || effectiveDisplayName);
    const parsedRole = ComputerRoleCodeSchema.safeParse(datadivas?.funcao);
    const role: ComputerRoleCode = parsedRole.success ? parsedRole.data : inferred.role;

    const age = doc.lastSeenAt ? currentNow.getTime() - Date.parse(doc.lastSeenAt) : NaN;
    const isOnline = doc.enabled && Number.isFinite(age) && age >= 0 && age <= 90_000;
    const status: ExistingCompanyComputer['status'] = !doc.enabled
      ? 'DISABLED'
      : isOnline
        ? 'ONLINE'
        : 'OFFLINE';

    const actualNormalized = normalizeWindowsHostname(doc.hostname);
    const desiredNormalized = desiredFromMeta || normalizeWindowsHostname(doc.displayName) || null;
    const parsedRenameStatus = RenameStatusSchema.safeParse(datadivas?.statusRenomeacao);
    let renameStatus: RenameStatus = parsedRenameStatus.success ? parsedRenameStatus.data : 'NAO_SOLICITADO';

    if (desiredNormalized && actualNormalized) {
      if (renameStatus === 'APLICADO_AGUARDANDO_REBOOT' && actualNormalized === desiredNormalized) {
        renameStatus = 'CONFIRMADO';
      } else if (renameStatus === 'CONFIRMADO' && actualNormalized !== desiredNormalized) {
        renameStatus = 'DIVERGENTE';
      } else if (renameStatus === 'NAO_SOLICITADO' && actualNormalized === desiredNormalized) {
        renameStatus = 'CONFIRMADO';
      }
    }

    return {
      deviceId: doc.id,
      deviceUuid: doc.deviceUuid,
      displayName: doc.displayName,
      windowsHostnameAtual: doc.hostname,
      windowsHostnameDesejado: desiredNormalized,
      role,
      roleLabel: getRoleLabel(role),
      rustdeskId: doc.rustdeskId,
      status,
      renameStatus,
      lastSeenAt: doc.lastSeenAt,
      isCurrentMachine: Boolean(
        currentMachineUuid && doc.deviceUuid.toLowerCase() === currentMachineUuid.toLowerCase(),
      ),
    };
  }

  async function resolveOrCreateCnpjGroup(
    cnpj14: string,
    razaoSocial: string | undefined,
    nomeFantasia: string | undefined,
    sourceIp: string,
    consolidateExisting = true,
  ): Promise<{
    organization: Organization;
    devices: RawDeviceDocument[];
    createdNewGroup: boolean;
    consolidatedCount: number;
  }> {
    const [allOrgs, allDevices] = await Promise.all([repo.listOrganizations(), repo.listAllDevices()]);
    const cnpjSlug = `cnpj-${cnpj14}`;
    const matchingDevices = allDevices.filter((dev) => {
      const { datadivas } = extractDataDivasFromNotes(dev.notes);
      return normalizeCnpj(datadivas?.cnpj) === cnpj14;
    });

    const preferredName = (
      normalizeCompanyLabel(nomeFantasia) ||
      normalizeCompanyLabel(razaoSocial) ||
      (matchingDevices[0]
        ? normalizeCompanyLabel(extractDataDivasFromNotes(matchingDevices[0].notes).datadivas?.nomeFantasia) ||
          normalizeCompanyLabel(extractDataDivasFromNotes(matchingDevices[0].notes).datadivas?.razaoSocial)
        : '') ||
      `Empresa ${formatCnpj(cnpj14)}`
    ).slice(0, 128);

    let groupOrg = allOrgs.find((org) => org.slug === cnpjSlug && org.active);
    if (!groupOrg && matchingDevices.length > 0) {
      const counts = new Map<string, number>();
      for (const dev of matchingDevices) {
        counts.set(dev.organizationId, (counts.get(dev.organizationId) ?? 0) + 1);
      }
      let bestOrgId = matchingDevices[0]!.organizationId;
      let bestCount = 0;
      for (const [orgId, count] of counts) {
        if (count > bestCount) {
          bestOrgId = orgId;
          bestCount = count;
        }
      }
      groupOrg = allOrgs.find((org) => org.id === bestOrgId && org.active);
    }

    if (!groupOrg && preferredName) {
      const normPref = preferredName.toLowerCase();
      groupOrg = allOrgs.find((org) => org.active && org.name.toLowerCase() === normPref);
    }

    let createdNewGroup = false;
    if (!groupOrg) {
      const id = enrollmentId('cnpj-org', cnpj14);
      groupOrg = {
        id,
        name: preferredName,
        slug: cnpjSlug,
        active: true,
      };
      await repo.createOrganization(groupOrg);
      createdNewGroup = true;
      await repo.appendHistory(
        {
          id: randomUUID(),
          at: now().toISOString(),
          groupId: groupOrg.id,
          cnpj: cnpj14,
          deviceId: null,
          deviceUuid: null,
          eventType: 'GROUP_CREATED',
          normalizedName: null,
          role: null,
          operatorId: null,
          result: 'success',
          detail: `Grupo empresarial criado automaticamente para o CNPJ ${formatCnpj(cnpj14)} (${groupOrg.name}).`,
        },
        sourceIp,
      );
    }

    // Also include devices already inside groupOrg even if their notes didn't yet store the CNPJ
    const groupDevicesMap = new Map<string, RawDeviceDocument>();
    for (const dev of allDevices) {
      if (dev.organizationId === groupOrg.id) {
        groupDevicesMap.set(dev.id, dev);
      }
    }
    for (const dev of matchingDevices) {
      groupDevicesMap.set(dev.id, dev);
    }

    let consolidatedCount = 0;
    if (consolidateExisting) {
      for (const dev of matchingDevices) {
        if (dev.organizationId !== groupOrg.id) {
          await repo.updateDevice(dev.id, { organizationId: groupOrg.id });
          dev.organizationId = groupOrg.id;
          groupDevicesMap.set(dev.id, dev);
          consolidatedCount++;
        }
      }
    }

    return {
      organization: groupOrg,
      devices: Array.from(groupDevicesMap.values()),
      createdNewGroup,
      consolidatedCount,
    };
  }

  function buildOccupiedNamesSet(
    computers: ExistingCompanyComputer[],
    reservations: NamingReservationRecord[],
    currentNow: Date,
    excludeDeviceUuid?: string | null,
    excludeDeviceId?: string | null,
  ): Set<string> {
    const occupied = new Set<string>();
    const normExcludeUuid = excludeDeviceUuid?.toLowerCase();
    for (const comp of computers) {
      if (comp.status === 'DISABLED') continue;
      if (normExcludeUuid && comp.deviceUuid.toLowerCase() === normExcludeUuid) continue;
      if (excludeDeviceId && comp.deviceId === excludeDeviceId) continue;

      const desired = comp.windowsHostnameDesejado ? normalizeWindowsHostname(comp.windowsHostnameDesejado) : '';
      const display = normalizeWindowsHostname(comp.displayName);
      const actual = normalizeWindowsHostname(comp.windowsHostnameAtual);
      if (desired) occupied.add(desired);
      if (display) occupied.add(display);
      if (!desired && !display && actual) occupied.add(actual);
    }
    for (const res of reservations) {
      if (!isReservationActive(res, currentNow)) continue;
      if (normExcludeUuid && res.deviceUuid?.toLowerCase() === normExcludeUuid) continue;
      if (excludeDeviceId && res.deviceId === excludeDeviceId) continue;
      const norm = normalizeWindowsHostname(res.normalizedName);
      if (norm) occupied.add(norm);
    }
    return occupied;
  }

  return {
    async getInstallationContext(capability, input, sourceIp) {
      const request = InstallationContextRequestSchema.parse(input);
      await verifyInstallerCapability(request.installerId, capability);
      const cnpj14 = normalizeCnpj(request.cnpj);
      if (!cnpj14) {
        throw new CnpjNamingError('INVALID_CNPJ', 'CNPJ inválido; informe os 14 dígitos.', 400);
      }

      return serial(`cnpj/${cnpj14}`, async () => {
        const currentNow = now();
        const { organization, devices } = await resolveOrCreateCnpjGroup(
          cnpj14,
          request.razaoSocial,
          request.nomeFantasia,
          sourceIp,
          true,
        );
        const reservations = await repo.listReservations(organization.id);
        const computers = devices.map((doc) =>
          resolveDeviceNamingState(doc, currentNow, request.deviceUuid),
        );

        // Append active reservations that are not yet attached to an enrolled device
        const enrolledNames = new Set(
          computers.flatMap((c) => [
            normalizeWindowsHostname(c.displayName),
            normalizeWindowsHostname(c.windowsHostnameDesejado),
          ]),
        );
        for (const res of reservations) {
          if (isReservationActive(res, currentNow) && !enrolledNames.has(res.normalizedName)) {
            const isSameUuid = Boolean(
              request.deviceUuid &&
                res.deviceUuid &&
                res.deviceUuid.toLowerCase() === request.deviceUuid.toLowerCase(),
            );
            computers.push({
              deviceId: res.deviceId ?? res.id,
              deviceUuid: res.deviceUuid ?? '00000000-0000-4000-8000-000000000000',
              displayName: res.normalizedName,
              windowsHostnameAtual: res.normalizedName,
              windowsHostnameDesejado: res.normalizedName,
              role: res.role,
              roleLabel: getRoleLabel(res.role),
              rustdeskId: 'RESERVADO',
              status: 'RESERVED',
              renameStatus: res.status === 'AWAITING_REBOOT' ? 'APLICADO_AGUARDANDO_REBOOT' : 'RESERVADO',
              lastSeenAt: res.reservedAt,
              isCurrentMachine: isSameUuid,
            });
          }
        }

        const matchedComputer = computers.find(
          (c) => c.isCurrentMachine && c.status !== 'DISABLED' && c.status !== 'RESERVED',
        );
        const operationMode = matchedComputer ? 'REINSTALL_SAME_DEVICE' : 'NEW_INSTALL';

        const selfCurrentName = matchedComputer
          ? matchedComputer.windowsHostnameDesejado || matchedComputer.displayName
          : null;
        const occupied = buildOccupiedNamesSet(
          computers,
          reservations,
          currentNow,
          request.deviceUuid,
          matchedComputer?.deviceId,
        );

        const catalog: CatalogRoleOption[] = COMPUTER_ROLE_CATALOG.map((item) => {
          const suggestion = suggestNameForRole(item.code, occupied, null, selfCurrentName);
          return {
            code: item.code,
            label: item.label,
            exclusive: item.exclusive,
            suggestedName: suggestion.suggestedName,
            available: suggestion.available,
            explanation: suggestion.explanation,
          };
        });

        const hasServer = occupied.has('SERVIDOR') || matchedComputer?.role === 'SERVIDOR';
        const currentHostCheck = validateWindowsHostname(request.currentWindowsHostname);
        const currentHostnameValidAndAvailable =
          currentHostCheck.valid && !occupied.has(currentHostCheck.normalized);

        let recommendedRole: ComputerRoleCode = 'CAIXA';
        let recommendedName = 'CAIXA-01';
        let recommendationExplanation = '';

        if (matchedComputer) {
          recommendedRole = matchedComputer.role;
          recommendedName =
            normalizeWindowsHostname(matchedComputer.windowsHostnameDesejado || matchedComputer.displayName) ||
            'CAIXA-01';
          recommendationExplanation = `Reinstalação reconhecida neste computador (${matchedComputer.displayName}). Preservando o nome ${recommendedName} (${matchedComputer.roleLabel}) sem duplicar o registro.`;
        } else if (!hasServer && computers.filter((c) => c.status !== 'DISABLED').length === 0) {
          const srvOption = catalog.find((c) => c.code === 'SERVIDOR')!;
          recommendedRole = 'SERVIDOR';
          recommendedName = srvOption.suggestedName;
          recommendationExplanation =
            'Primeiro computador identificado para este CNPJ. O grupo empresarial foi preparado e a função SERVIDOR está disponível.';
        } else {
          const caixaOption = catalog.find((c) => c.code === 'CAIXA')!;
          recommendedRole = 'CAIXA';
          recommendedName = caixaOption.suggestedName;
          recommendationExplanation = caixaOption.explanation;
        }

        const firstMeta = devices[0] ? extractDataDivasFromNotes(devices[0].notes).datadivas : null;
        const razaoSocial =
          normalizeCompanyLabel(request.razaoSocial) ||
          normalizeCompanyLabel(firstMeta?.razaoSocial) ||
          organization.name;
        const nomeFantasia =
          normalizeCompanyLabel(request.nomeFantasia) ||
          normalizeCompanyLabel(firstMeta?.nomeFantasia) ||
          organization.name;

        await repo.appendHistory(
          {
            id: randomUUID(),
            at: currentNow.toISOString(),
            groupId: organization.id,
            cnpj: cnpj14,
            deviceId: matchedComputer?.deviceId ?? null,
            deviceUuid: request.deviceUuid ?? null,
            eventType: 'COMPUTER_IDENTIFIED',
            normalizedName: recommendedName,
            role: recommendedRole,
            operatorId: null,
            result: 'success',
            detail:
              operationMode === 'REINSTALL_SAME_DEVICE'
                ? `Reinstalação identificada (${recommendedName}).`
                : `Nova instalação iniciada. Recomendação inicial: ${recommendedName} (${getRoleLabel(recommendedRole)}).`,
          },
          sourceIp,
        );

        return InstallationContextResponseSchema.parse({
          groupId: organization.id,
          organizationName: organization.name,
          cnpj: cnpj14,
          formattedCnpj: formatCnpj(cnpj14),
          razaoSocial,
          nomeFantasia,
          totalComputers: computers.filter((c) => c.status !== 'DISABLED').length,
          operationMode,
          matchedDeviceId: matchedComputer?.deviceId ?? null,
          hasServer,
          computers,
          catalog,
          recommendedRole,
          recommendedName,
          recommendationExplanation,
          currentHostnameValidAndAvailable,
        });
      });
    },

    async suggestName(capability, technician, input) {
      const request = SuggestNameRequestSchema.parse(input);
      if (request.installerId && capability) {
        await verifyInstallerCapability(request.installerId, capability);
      } else if (!technician) {
        throw new CnpjNamingError('NAMING_ACCESS_DENIED', 'Authentication required', 403);
      }
      const cnpj14 = normalizeCnpj(request.cnpj);
      if (!cnpj14) {
        throw new CnpjNamingError('INVALID_CNPJ', 'CNPJ inválido; informe os 14 dígitos.', 400);
      }

      return serial(`cnpj/${cnpj14}`, async () => {
        const currentNow = now();
        const { organization, devices } = await resolveOrCreateCnpjGroup(
          cnpj14,
          undefined,
          undefined,
          '127.0.0.1',
          false,
        );
        const reservations = await repo.listReservations(organization.id);
        const computers = devices.map((doc) =>
          resolveDeviceNamingState(doc, currentNow, request.deviceUuid),
        );
        const occupied = buildOccupiedNamesSet(
          computers,
          reservations,
          currentNow,
          request.deviceUuid,
          request.replaceDeviceId,
        );
        const result = suggestNameForRole(request.role, occupied, request.customName, null);
        return SuggestNameResponseSchema.parse({
          role: result.role,
          roleLabel: getRoleLabel(result.role),
          suggestedName: result.suggestedName,
          available: result.available,
          ...(result.conflictName ? { conflictName: result.conflictName } : {}),
          explanation: result.explanation,
        });
      });
    },

    async reserveName(capability, input, sourceIp) {
      const request = ReserveNameRequestSchema.parse(input);
      await verifyInstallerCapability(request.installerId, capability);
      const cnpj14 = normalizeCnpj(request.cnpj);
      if (!cnpj14) {
        throw new CnpjNamingError('INVALID_CNPJ', 'CNPJ inválido; informe os 14 dígitos.', 400);
      }

      return serial(`cnpj/${cnpj14}`, async () => {
        const currentNow = now();
        const { organization, devices } = await resolveOrCreateCnpjGroup(
          cnpj14,
          request.razaoSocial,
          request.nomeFantasia,
          sourceIp,
          true,
        );
        const reservations = await repo.listReservations(organization.id);
        const computers = devices.map((doc) =>
          resolveDeviceNamingState(doc, currentNow, request.deviceUuid),
        );
        const matchedComputer = computers.find(
          (c) => c.isCurrentMachine && c.status !== 'DISABLED',
        );
        const mode =
          request.operationMode ??
          (request.replaceDeviceId
            ? 'REPLACE_DEVICE'
            : matchedComputer
              ? 'REINSTALL_SAME_DEVICE'
              : 'NEW_INSTALL');

        const hostValidation = validateWindowsHostname(request.desiredName);
        if (!hostValidation.valid) {
          const occupied = buildOccupiedNamesSet(
            computers,
            reservations,
            currentNow,
            request.deviceUuid,
            request.replaceDeviceId ?? matchedComputer?.deviceId,
          );
          const fallback = suggestNameForRole(request.role, occupied, null, null);
          return ReserveNameResponseSchema.parse({
            reserved: false,
            reservationId: null,
            uniqueKey: null,
            groupId: organization.id,
            organizationName: organization.name,
            cnpj: cnpj14,
            role: request.role,
            normalizedName: fallback.suggestedName,
            operationMode: mode,
            expiresAt: null,
            suggestedAlternative: fallback.suggestedName,
            explanation: `${hostValidation.reason} Sugerimos ${fallback.suggestedName}.`,
          });
        }

        const normalizedDesired =
          request.role === 'SERVIDOR' ? 'SERVIDOR' : hostValidation.normalized;
        const occupied = buildOccupiedNamesSet(
          computers,
          reservations,
          currentNow,
          request.deviceUuid,
          mode === 'REPLACE_DEVICE' ? request.replaceDeviceId : matchedComputer?.deviceId,
        );

        if (occupied.has(normalizedDesired)) {
          const suggestion = suggestNameForRole(
            request.role === 'SERVIDOR' ? 'CAIXA' : request.role,
            occupied,
            request.role === 'PERSONALIZADO' ? normalizedDesired : null,
            null,
          );
          await repo.appendHistory(
            {
              id: randomUUID(),
              at: currentNow.toISOString(),
              groupId: organization.id,
              cnpj: cnpj14,
              deviceId: matchedComputer?.deviceId ?? null,
              deviceUuid: request.deviceUuid ?? null,
              eventType: 'NAME_CONFLICT',
              normalizedName: normalizedDesired,
              role: request.role,
              operatorId: null,
              result: 'failure',
              detail: `Conflito ao tentar reservar ${normalizedDesired}. Sugerido: ${suggestion.suggestedName}.`,
            },
            sourceIp,
          );

          const conflictExplanation =
            request.role === 'SERVIDOR'
              ? `Já existe um SERVIDOR cadastrado para este CNPJ. O nome SERVIDOR é exclusivo; sugerimos ${suggestion.suggestedName} ou selecione Substituição de Computador.`
              : `O nome ${normalizedDesired} já pertence a outro computador deste CNPJ. Sugerimos ${suggestion.suggestedName}.`;

          return ReserveNameResponseSchema.parse({
            reserved: false,
            reservationId: null,
            uniqueKey: null,
            groupId: organization.id,
            organizationName: organization.name,
            cnpj: cnpj14,
            role: request.role,
            normalizedName: normalizedDesired,
            operationMode: mode,
            expiresAt: null,
            conflictName: normalizedDesired,
            suggestedAlternative: suggestion.suggestedName,
            explanation: conflictExplanation,
          });
        }

        // If replacing an existing computer, mark the old device as replaced/disabled
        if (mode === 'REPLACE_DEVICE' && request.replaceDeviceId) {
          const replacedDoc = devices.find((d) => d.id === request.replaceDeviceId);
          if (replacedDoc) {
            const updatedNotes = mergeDataDivasIntoNotes(replacedDoc.notes, {
              statusRenomeacao: 'NAO_SOLICITADO',
              windowsHostnameDesejado: `${replacedDoc.displayName}-ANTIGO`.slice(0, 15),
            });
            await repo.updateDevice(replacedDoc.id, {
              displayName: `${replacedDoc.displayName} (Substituído)`.slice(0, 128),
              enabled: false,
              notes: updatedNotes,
            });
            await repo.appendHistory(
              {
                id: randomUUID(),
                at: currentNow.toISOString(),
                groupId: organization.id,
                cnpj: cnpj14,
                deviceId: replacedDoc.id,
                deviceUuid: request.deviceUuid ?? null,
                eventType: 'NAME_TRANSFERRED',
                normalizedName: normalizedDesired,
                role: request.role,
                operatorId: null,
                result: 'success',
                detail: `Nome ${normalizedDesired} transferido do computador substituído (${replacedDoc.id}) para a nova instalação.`,
              },
              sourceIp,
            );
          }
        }

        const resId = reservationDocId(cnpj14, normalizedDesired);
        const uniqueKey = `${cnpj14}|${normalizedDesired}`;
        const expiresAt = new Date(currentNow.getTime() + 30 * 60_000).toISOString();

        const record: NamingReservationRecord = {
          id: resId,
          groupId: organization.id,
          cnpj: cnpj14,
          normalizedName: normalizedDesired,
          uniqueKey,
          role: request.role,
          deviceId: matchedComputer?.deviceId ?? null,
          deviceUuid: request.deviceUuid ?? null,
          status: 'RESERVED',
          reservedAt: currentNow.toISOString(),
          expiresAt,
        };

        await repo.upsertReservation(record, sourceIp);
        await repo.appendHistory(
          {
            id: randomUUID(),
            at: currentNow.toISOString(),
            groupId: organization.id,
            cnpj: cnpj14,
            deviceId: matchedComputer?.deviceId ?? null,
            deviceUuid: request.deviceUuid ?? null,
            eventType: 'NAME_RESERVED',
            normalizedName: normalizedDesired,
            role: request.role,
            operatorId: null,
            result: 'success',
            detail: `Nome ${normalizedDesired} (${getRoleLabel(request.role)}) reservado exclusivamente (${uniqueKey}).`,
          },
          sourceIp,
        );

        return ReserveNameResponseSchema.parse({
          reserved: true,
          reservationId: resId,
          uniqueKey,
          groupId: organization.id,
          organizationName: organization.name,
          cnpj: cnpj14,
          role: request.role,
          normalizedName: normalizedDesired,
          operationMode: mode,
          expiresAt,
          explanation: `Nome ${normalizedDesired} reservado com exclusividade para este computador.`,
        });
      });
    },

    async confirmName(capability, input, sourceIp) {
      const request = ConfirmNameRequestSchema.parse(input);
      if (request.installerId && capability) {
        await verifyInstallerCapability(request.installerId, capability);
      }
      const cnpj14 = normalizeCnpj(request.cnpj);
      if (!cnpj14) {
        throw new CnpjNamingError('INVALID_CNPJ', 'CNPJ inválido.', 400);
      }

      return serial(`cnpj/${cnpj14}`, async () => {
        const currentNow = now();
        const { organization, devices } = await resolveOrCreateCnpjGroup(
          cnpj14,
          undefined,
          undefined,
          sourceIp,
          false,
        );
        const normalizedDesired = normalizeWindowsHostname(request.desiredName);
        const normalizedActual = normalizeWindowsHostname(request.actualWindowsHostname);
        const role = request.role ?? inferRoleFromName(normalizedDesired).role;

        let statusRenomeacao: RenameStatus = 'CONFIRMADO';
        let reservationStatus: NamingReservationRecord['status'] = 'CONFIRMED';
        let eventType: NamingHistoryEvent['eventType'] = 'RENAME_COMPLETED';
        let result: 'success' | 'failure' = 'success';
        let detail = `Nome Windows ${normalizedDesired} confirmado no equipamento.`;

        if (!request.renameApplied) {
          statusRenomeacao = 'ERRO';
          reservationStatus = 'RESERVED';
          eventType = 'RENAME_FAILED';
          result = 'failure';
          detail = `Falha ao renomear o Windows para ${normalizedDesired}: ${request.errorDetail || 'Erro reportado pelo sistema operacional'}. Acesso remoto mantido.`;
        } else if (request.rebootRequired && normalizedActual !== normalizedDesired) {
          statusRenomeacao = 'APLICADO_AGUARDANDO_REBOOT';
          reservationStatus = 'AWAITING_REBOOT';
          eventType = 'REBOOT_PENDING';
          detail = `Nome Windows alterado para ${normalizedDesired}. Aguardando reinicialização do computador (atual: ${request.actualWindowsHostname}).`;
        }

        const targetDevice = devices.find(
          (d) => d.deviceUuid.toLowerCase() === request.deviceUuid.toLowerCase(),
        );
        if (targetDevice) {
          const nextNotes = mergeDataDivasIntoNotes(targetDevice.notes, {
            cnpj: cnpj14,
            funcao: role,
            windowsHostnameDesejado: normalizedDesired,
            statusRenomeacao,
            erroRenomeacao: request.errorDetail || '',
            ultimaSincronizacao: currentNow.toISOString(),
          });
          await repo.updateDevice(targetDevice.id, {
            displayName: normalizedDesired,
            hostname: request.actualWindowsHostname,
            notes: nextNotes,
          });
        }

        const resId = request.reservationId || reservationDocId(cnpj14, normalizedDesired);
        const record: NamingReservationRecord = {
          id: resId,
          groupId: organization.id,
          cnpj: cnpj14,
          normalizedName: normalizedDesired,
          uniqueKey: `${cnpj14}|${normalizedDesired}`,
          role,
          deviceId: targetDevice?.id ?? null,
          deviceUuid: request.deviceUuid,
          status: reservationStatus,
          reservedAt: currentNow.toISOString(),
          expiresAt: null,
        };
        await repo.upsertReservation(record, sourceIp);

        await repo.appendHistory(
          {
            id: randomUUID(),
            at: currentNow.toISOString(),
            groupId: organization.id,
            cnpj: cnpj14,
            deviceId: targetDevice?.id ?? null,
            deviceUuid: request.deviceUuid,
            eventType,
            normalizedName: normalizedDesired,
            role,
            operatorId: null,
            result,
            detail,
          },
          sourceIp,
        );

        return ConfirmNameResponseSchema.parse({
          confirmed: true,
          statusRenomeacao,
          windowsHostnameAtual: request.actualWindowsHostname,
          windowsHostnameDesejado: normalizedDesired,
        });
      });
    },

    async releaseName(capability, technician, input, sourceIp) {
      const request = ReleaseNameRequestSchema.parse(input);
      if (request.installerId && capability) {
        await verifyInstallerCapability(request.installerId, capability);
      } else if (!technician) {
        throw new CnpjNamingError('NAMING_ACCESS_DENIED', 'Authentication required', 403);
      }
      const cnpj14 = normalizeCnpj(request.cnpj);
      if (!cnpj14) {
        throw new CnpjNamingError('INVALID_CNPJ', 'CNPJ inválido.', 400);
      }

      return serial(`cnpj/${cnpj14}`, async () => {
        const currentNow = now();
        const { organization } = await resolveOrCreateCnpjGroup(
          cnpj14,
          undefined,
          undefined,
          sourceIp,
          false,
        );
        const normalizedDesired = normalizeWindowsHostname(request.desiredName);
        const resId = request.reservationId || reservationDocId(cnpj14, normalizedDesired);
        const existing = await repo.getReservation(resId);
        const uniqueKey = `${cnpj14}|${normalizedDesired}`;

        if (!existing) {
          return ReleaseNameResponseSchema.parse({ released: false, uniqueKey });
        }

        // Prevent unauthenticated/automatic release of names awaiting reboot or confirmed on active devices
        if (!technician && (existing.status === 'AWAITING_REBOOT' || existing.status === 'CONFIRMED')) {
          return ReleaseNameResponseSchema.parse({ released: false, uniqueKey });
        }

        const updated: NamingReservationRecord = {
          ...existing,
          status: 'RELEASED',
          expiresAt: currentNow.toISOString(),
        };
        await repo.upsertReservation(updated, sourceIp);
        await repo.appendHistory(
          {
            id: randomUUID(),
            at: currentNow.toISOString(),
            groupId: organization.id,
            cnpj: cnpj14,
            deviceId: existing.deviceId,
            deviceUuid: existing.deviceUuid,
            eventType: 'NAME_RELEASED',
            normalizedName: normalizedDesired,
            role: existing.role,
            operatorId: technician?.userId ?? null,
            result: 'success',
            detail: `Reserva do nome ${normalizedDesired} liberada para reutilização.`,
          },
          sourceIp,
        );

        return ReleaseNameResponseSchema.parse({ released: true, uniqueKey });
      });
    },

    async syncDevice(input, sourceIp) {
      const request = DeviceSyncRequestSchema.parse(input);
      const currentNow = now();
      const allDevices = await repo.listAllDevices();
      const targetDevice = allDevices.find(
        (d) => d.deviceUuid.toLowerCase() === request.deviceUuid.toLowerCase(),
      );
      if (!targetDevice) {
        throw new CnpjNamingError('DEVICE_NOT_FOUND', 'Equipamento não encontrado para sincronização.', 404);
      }

      const { datadivas } = extractDataDivasFromNotes(targetDevice.notes);
      const cnpj14 = normalizeCnpj(request.cnpj ?? datadivas?.cnpj);
      const desired = datadivas?.windowsHostnameDesejado
        ? normalizeWindowsHostname(datadivas.windowsHostnameDesejado)
        : normalizeWindowsHostname(targetDevice.displayName);
      const actual = normalizeWindowsHostname(request.windowsHostnameAtual);

      const parsedPrev = RenameStatusSchema.safeParse(datadivas?.statusRenomeacao);
      let statusRenomeacao: RenameStatus = parsedPrev.success ? parsedPrev.data : 'NAO_SOLICITADO';

      if (desired && actual === desired) {
        if (statusRenomeacao === 'APLICADO_AGUARDANDO_REBOOT' || statusRenomeacao === 'RESERVADO' || statusRenomeacao === 'DIVERGENTE') {
          statusRenomeacao = 'CONFIRMADO';
          if (cnpj14) {
            const resId = reservationDocId(cnpj14, desired);
            const existingRes = await repo.getReservation(resId);
            if (existingRes && existingRes.status !== 'CONFIRMED') {
              await repo.upsertReservation({ ...existingRes, status: 'CONFIRMED', expiresAt: null }, sourceIp);
            }
            await repo.appendHistory(
              {
                id: randomUUID(),
                at: currentNow.toISOString(),
                groupId: targetDevice.organizationId,
                cnpj: cnpj14,
                deviceId: targetDevice.id,
                deviceUuid: targetDevice.deviceUuid,
                eventType: 'RENAME_COMPLETED',
                normalizedName: desired,
                role: inferRoleFromName(desired).role,
                operatorId: null,
                result: 'success',
                detail: `Sincronização pós-reinicialização confirmou o nome Windows ${request.windowsHostnameAtual}.`,
              },
              sourceIp,
            );
          }
        }
      } else if (desired && statusRenomeacao === 'CONFIRMADO' && actual !== desired) {
        statusRenomeacao = 'DIVERGENTE';
      }

      const nextNotes = mergeDataDivasIntoNotes(targetDevice.notes, {
        ...(cnpj14 ? { cnpj: cnpj14 } : {}),
        windowsHostnameDesejado: desired || undefined,
        statusRenomeacao,
        ultimaSincronizacao: currentNow.toISOString(),
      });

      await repo.updateDevice(targetDevice.id, {
        hostname: request.windowsHostnameAtual,
        rustdeskId: request.rustdeskId,
        notes: nextNotes,
      });

      return DeviceSyncResponseSchema.parse({
        synced: true,
        deviceId: targetDevice.id,
        statusRenomeacao,
        windowsHostnameDesejado: desired || null,
      });
    },

    async listCnpjGroups(technician, cnpjFilter) {
      const currentNow = now();
      const allowedOrgIds = new Set(
        technician.authorization.filter((a) => a.canView).map((a) => a.organizationId),
      );
      const [allOrgs, allDevices] = await Promise.all([repo.listOrganizations(), repo.listAllDevices()]);
      const orgById = new Map(allOrgs.map((o) => [o.id, o]));

      const visibleDevices = allDevices.filter(
        (d) => technician.globalRole === 'super_admin' || allowedOrgIds.has(d.organizationId),
      );

      const byCnpj = new Map<string, { org: Organization; devices: RawDeviceDocument[] }>();
      for (const dev of visibleDevices) {
        const { datadivas } = extractDataDivasFromNotes(dev.notes);
        const org = orgById.get(dev.organizationId);
        if (!org) continue;
        const cnpjFromSlug = org.slug.startsWith('cnpj-') ? normalizeCnpj(org.slug.slice(5)) : null;
        const cnpj14 = normalizeCnpj(datadivas?.cnpj) ?? cnpjFromSlug;
        if (!cnpj14) continue;
        if (cnpjFilter && normalizeCnpj(cnpjFilter) && cnpj14 !== normalizeCnpj(cnpjFilter)) continue;

        const existing = byCnpj.get(cnpj14);
        if (existing) {
          existing.devices.push(dev);
        } else {
          byCnpj.set(cnpj14, { org, devices: [dev] });
        }
      }

      const groups: CnpjCompanyGroupView[] = [];
      for (const [cnpj14, entry] of byCnpj) {
        const [reservations, history] = await Promise.all([
          repo.listReservations(entry.org.id),
          repo.listHistory(entry.org.id),
        ]);
        const computers = entry.devices.map((doc) => resolveDeviceNamingState(doc, currentNow));
        const firstMeta = entry.devices[0]
          ? extractDataDivasFromNotes(entry.devices[0].notes).datadivas
          : null;

        const nameCounts = new Map<string, number>();
        for (const comp of computers) {
          if (comp.status === 'DISABLED') continue;
          const norm = normalizeWindowsHostname(comp.windowsHostnameDesejado || comp.displayName);
          if (norm) nameCounts.set(norm, (nameCounts.get(norm) ?? 0) + 1);
        }
        let conflictCount = 0;
        for (const count of nameCounts.values()) {
          if (count > 1) conflictCount += count - 1;
        }

        groups.push(
          CnpjCompanyGroupViewSchema.parse({
            groupId: entry.org.id,
            organizationName: entry.org.name,
            cnpj: cnpj14,
            formattedCnpj: formatCnpj(cnpj14),
            razaoSocial: firstMeta?.razaoSocial ?? entry.org.name,
            nomeFantasia: firstMeta?.nomeFantasia ?? entry.org.name,
            totalComputers: computers.filter((c) => c.status !== 'DISABLED').length,
            onlineComputers: computers.filter((c) => c.status === 'ONLINE').length,
            pendingRenameCount: computers.filter(
              (c) =>
                c.renameStatus === 'APLICADO_AGUARDANDO_REBOOT' ||
                c.renameStatus === 'RESERVADO' ||
                c.renameStatus === 'DIVERGENTE' ||
                c.renameStatus === 'ERRO',
            ).length,
            conflictCount,
            hasServer: computers.some((c) => c.status !== 'DISABLED' && c.role === 'SERVIDOR'),
            computers,
            reservations: reservations.filter((r) => isReservationActive(r, currentNow)),
            history,
          }),
        );
      }

      groups.sort((a, b) => a.organizationName.localeCompare(b.organizationName, 'pt-BR'));
      return CnpjGroupsListResponseSchema.parse({ groups });
    },

    async adminAction(technician, input, sourceIp) {
      const request = AdminCnpjNamingActionRequestSchema.parse(input);
      const cnpj14 = normalizeCnpj(request.cnpj);
      if (!cnpj14) {
        throw new CnpjNamingError('INVALID_CNPJ', 'CNPJ inválido.', 400);
      }

      return serial(`cnpj/${cnpj14}`, async () => {
        const currentNow = now();
        const { organization, devices } = await resolveOrCreateCnpjGroup(
          cnpj14,
          undefined,
          undefined,
          sourceIp,
          false,
        );

        const hasPermission =
          technician.globalRole === 'super_admin' ||
          technician.authorization.some(
            (a) => a.organizationId === organization.id && a.canView && a.canManageDevices,
          );
        if (!hasPermission) {
          throw new CnpjNamingError('NAMING_ACCESS_DENIED', 'Permissão insuficiente para gerenciar este CNPJ.', 403);
        }

        if (request.action === 'RELEASE_NAME') {
          const norm = normalizeWindowsHostname(request.normalizedName);
          const resId = reservationDocId(cnpj14, norm);
          const existing = await repo.getReservation(resId);
          if (existing) {
            await repo.upsertReservation(
              { ...existing, status: 'RELEASED', expiresAt: currentNow.toISOString() },
              sourceIp,
            );
          }
          await repo.appendHistory(
            {
              id: randomUUID(),
              at: currentNow.toISOString(),
              groupId: organization.id,
              cnpj: cnpj14,
              deviceId: request.deviceId ?? existing?.deviceId ?? null,
              deviceUuid: existing?.deviceUuid ?? null,
              eventType: 'NAME_RELEASED',
              normalizedName: norm,
              role: existing?.role ?? null,
              operatorId: technician.userId,
              result: 'success',
              detail: `Nome ${norm} liberado administrativamente por ${technician.displayName}.`,
            },
            sourceIp,
          );
        } else if (request.action === 'UPDATE_ROLE_AND_NAME') {
          const target = devices.find((d) => d.id === request.deviceId);
          if (!target) {
            throw new CnpjNamingError('DEVICE_NOT_FOUND', 'Computador não encontrado neste CNPJ.', 404);
          }
          const validation = validateWindowsHostname(request.desiredName);
          if (!validation.valid) {
            throw new CnpjNamingError('INVALID_HOSTNAME', validation.reason || 'Nome Windows inválido.', 400);
          }
          const normalizedDesired =
            request.role === 'SERVIDOR' ? 'SERVIDOR' : validation.normalized;
          const reservations = await repo.listReservations(organization.id);
          const computers = devices.map((doc) => resolveDeviceNamingState(doc, currentNow));
          const occupied = buildOccupiedNamesSet(
            computers,
            reservations,
            currentNow,
            target.deviceUuid,
            target.id,
          );
          if (occupied.has(normalizedDesired)) {
            throw new CnpjNamingError(
              'NAME_CONFLICT',
              `O nome ${normalizedDesired} já está ocupado neste CNPJ.`,
              409,
            );
          }

          const actualNorm = normalizeWindowsHostname(target.hostname);
          const statusRenomeacao: RenameStatus =
            actualNorm === normalizedDesired ? 'CONFIRMADO' : 'RESERVADO';

          const nextNotes = mergeDataDivasIntoNotes(target.notes, {
            cnpj: cnpj14,
            funcao: request.role,
            windowsHostnameDesejado: normalizedDesired,
            statusRenomeacao,
            ultimaSincronizacao: currentNow.toISOString(),
          });
          await repo.updateDevice(target.id, {
            displayName: normalizedDesired,
            notes: nextNotes,
          });

          const resId = reservationDocId(cnpj14, normalizedDesired);
          await repo.upsertReservation(
            {
              id: resId,
              groupId: organization.id,
              cnpj: cnpj14,
              normalizedName: normalizedDesired,
              uniqueKey: `${cnpj14}|${normalizedDesired}`,
              role: request.role,
              deviceId: target.id,
              deviceUuid: target.deviceUuid,
              status: statusRenomeacao === 'CONFIRMADO' ? 'CONFIRMED' : 'RESERVED',
              reservedAt: currentNow.toISOString(),
              expiresAt: null,
            },
            sourceIp,
          );

          await repo.appendHistory(
            {
              id: randomUUID(),
              at: currentNow.toISOString(),
              groupId: organization.id,
              cnpj: cnpj14,
              deviceId: target.id,
              deviceUuid: target.deviceUuid,
              eventType: 'ROLE_UPDATED',
              normalizedName: normalizedDesired,
              role: request.role,
              operatorId: technician.userId,
              result: 'success',
              detail: `Classificação atualizada para ${normalizedDesired} (${getRoleLabel(request.role)}) por ${technician.displayName}.`,
            },
            sourceIp,
          );
        } else if (request.action === 'TRANSFER_NAME') {
          const fromDev = devices.find((d) => d.id === request.fromDeviceId);
          const toDev = devices.find((d) => d.id === request.toDeviceId);
          if (!fromDev || !toDev) {
            throw new CnpjNamingError('DEVICE_NOT_FOUND', 'Computador de origem ou destino não encontrado.', 404);
          }
          const fromState = resolveDeviceNamingState(fromDev, currentNow);
          const transferredName =
            normalizeWindowsHostname(fromState.windowsHostnameDesejado || fromState.displayName) ||
            fromState.displayName;

          const oldNotes = mergeDataDivasIntoNotes(fromDev.notes, {
            funcao: 'PERSONALIZADO',
            windowsHostnameDesejado: `${transferredName}-ANTIGO`.slice(0, 15),
            statusRenomeacao: 'NAO_SOLICITADO',
          });
          await repo.updateDevice(fromDev.id, {
            displayName: `${transferredName} (Substituído)`.slice(0, 128),
            enabled: false,
            notes: oldNotes,
          });

          const toActualNorm = normalizeWindowsHostname(toDev.hostname);
          const nextToStatus: RenameStatus =
            toActualNorm === transferredName ? 'CONFIRMADO' : 'RESERVADO';
          const newNotes = mergeDataDivasIntoNotes(toDev.notes, {
            cnpj: cnpj14,
            funcao: fromState.role,
            windowsHostnameDesejado: transferredName,
            statusRenomeacao: nextToStatus,
            substituiuDeviceId: fromDev.id,
            ultimaSincronizacao: currentNow.toISOString(),
          });
          await repo.updateDevice(toDev.id, {
            displayName: transferredName,
            notes: newNotes,
          });

          const resId = reservationDocId(cnpj14, transferredName);
          await repo.upsertReservation(
            {
              id: resId,
              groupId: organization.id,
              cnpj: cnpj14,
              normalizedName: transferredName,
              uniqueKey: `${cnpj14}|${transferredName}`,
              role: fromState.role,
              deviceId: toDev.id,
              deviceUuid: toDev.deviceUuid,
              status: nextToStatus === 'CONFIRMADO' ? 'CONFIRMED' : 'RESERVED',
              reservedAt: currentNow.toISOString(),
              expiresAt: null,
            },
            sourceIp,
          );

          await repo.appendHistory(
            {
              id: randomUUID(),
              at: currentNow.toISOString(),
              groupId: organization.id,
              cnpj: cnpj14,
              deviceId: toDev.id,
              deviceUuid: toDev.deviceUuid,
              eventType: 'NAME_TRANSFERRED',
              normalizedName: transferredName,
              role: fromState.role,
              operatorId: technician.userId,
              result: 'success',
              detail: `Nome ${transferredName} (${fromState.roleLabel}) transferido de ${fromDev.id} para ${toDev.id} por ${technician.displayName}.`,
            },
            sourceIp,
          );
        }

        const refreshed = await this.listCnpjGroups(technician, cnpj14);
        if (!refreshed.groups[0]) {
          throw new CnpjNamingError('NAMING_UNAVAILABLE', 'Grupo empresarial não encontrado após atualização.', 503);
        }
        return refreshed.groups[0];
      });
    },

    async migrateExistingDevices(technician, input, sourceIp) {
      if (technician.globalRole !== 'super_admin') {
        throw new CnpjNamingError('NAMING_ACCESS_DENIED', 'Apenas superadministradores podem executar a migração por CNPJ.', 403);
      }
      const request = CnpjMigrationRequestSchema.parse(input);
      const currentNow = now();
      const [allOrgs, allDevices] = await Promise.all([repo.listOrganizations(), repo.listAllDevices()]);
      const orgById = new Map(allOrgs.map((o) => [o.id, o]));

      const anomalies: CnpjMigrationAnomaly[] = [];
      const byCnpj = new Map<string, RawDeviceDocument[]>();

      for (const dev of allDevices) {
        const { datadivas } = extractDataDivasFromNotes(dev.notes);
        const org = orgById.get(dev.organizationId);
        const cnpjFromSlug = org?.slug.startsWith('cnpj-') ? normalizeCnpj(org.slug.slice(5)) : null;
        const cnpj14 = normalizeCnpj(datadivas?.cnpj) ?? cnpjFromSlug;
        if (!cnpj14) {
          anomalies.push({
            type: 'MISSING_CNPJ',
            cnpj: null,
            deviceId: dev.id,
            displayName: dev.displayName,
            hostname: dev.hostname,
            detail: 'Equipamento antigo sem CNPJ identificado no cadastro; será atualizado automaticamente na próxima sincronização do agente.',
          });
          continue;
        }
        const list = byCnpj.get(cnpj14) ?? [];
        list.push(dev);
        byCnpj.set(cnpj14, list);
      }

      let consolidatedDevices = 0;
      let registeredReservations = 0;

      for (const [cnpj14, groupDevs] of byCnpj) {
        const firstMeta = extractDataDivasFromNotes(groupDevs[0]!.notes).datadivas;
        const seenNames = new Map<string, string>();
        let serverCount = 0;

        let targetGroupId = groupDevs[0]!.organizationId;
        if (!request.dryRun) {
          const resolved = await resolveOrCreateCnpjGroup(
            cnpj14,
            firstMeta?.razaoSocial,
            firstMeta?.nomeFantasia,
            sourceIp,
            true,
          );
          targetGroupId = resolved.organization.id;
          consolidatedDevices += resolved.consolidatedCount;
        } else {
          const distinctOrgs = new Set(groupDevs.map((d) => d.organizationId));
          if (distinctOrgs.size > 1) {
            for (const dev of groupDevs.slice(1)) {
              if (dev.organizationId !== targetGroupId) {
                consolidatedDevices++;
                anomalies.push({
                  type: 'CONSOLIDATED_ORGANIZATION',
                  cnpj: cnpj14,
                  deviceId: dev.id,
                  displayName: dev.displayName,
                  hostname: dev.hostname,
                  detail: `Equipamento do CNPJ ${formatCnpj(cnpj14)} será consolidado no grupo empresarial único (${targetGroupId}).`,
                });
              }
            }
          }
        }

        for (const dev of groupDevs) {
          const { datadivas } = extractDataDivasFromNotes(dev.notes);
          const actualNorm = normalizeWindowsHostname(dev.hostname);
          const displayNorm = normalizeWindowsHostname(dev.displayName);
          const effectiveName = normalizeWindowsHostname(datadivas?.windowsHostnameDesejado) || displayNorm || actualNorm;
          const inferred = inferRoleFromName(effectiveName);
          const role = ComputerRoleCodeSchema.safeParse(datadivas?.funcao).success
            ? (datadivas!.funcao as ComputerRoleCode)
            : inferred.role;

          if (role === 'SERVIDOR') {
            serverCount++;
            if (serverCount > 1) {
              anomalies.push({
                type: 'MULTIPLE_SERVERS_IN_CNPJ',
                cnpj: cnpj14,
                deviceId: dev.id,
                displayName: dev.displayName,
                hostname: dev.hostname,
                detail: `Mais de um computador identificado como SERVIDOR no CNPJ ${formatCnpj(cnpj14)}. Revisão recomendada.`,
              });
            }
          }

          if (actualNorm && displayNorm && actualNorm !== displayNorm) {
            anomalies.push({
              type: 'HOSTNAME_DISPLAY_MISMATCH',
              cnpj: cnpj14,
              deviceId: dev.id,
              displayName: dev.displayName,
              hostname: dev.hostname,
              detail: `Apelido cadastrado (${dev.displayName}) difere do hostname real do Windows (${dev.hostname}). O Windows não foi renomeado na migração.`,
            });
          }

          if (effectiveName) {
            if (seenNames.has(effectiveName)) {
              anomalies.push({
                type: 'DUPLICATE_NAME_IN_CNPJ',
                cnpj: cnpj14,
                deviceId: dev.id,
                displayName: dev.displayName,
                hostname: dev.hostname,
                detail: `Nome ${effectiveName} duplicado dentro do CNPJ ${formatCnpj(cnpj14)} (conflito com dispositivo ${seenNames.get(effectiveName)}).`,
              });
            } else {
              seenNames.set(effectiveName, dev.id);
              registeredReservations++;
              if (!request.dryRun) {
                const statusRenomeacao: RenameStatus =
                  actualNorm === effectiveName ? 'CONFIRMADO' : 'NAO_SOLICITADO';
                const nextNotes = mergeDataDivasIntoNotes(dev.notes, {
                  cnpj: cnpj14,
                  funcao: role,
                  windowsHostnameDesejado: effectiveName,
                  statusRenomeacao,
                  ultimaSincronizacao: currentNow.toISOString(),
                });
                await repo.updateDevice(dev.id, { notes: nextNotes });
                await repo.upsertReservation(
                  {
                    id: reservationDocId(cnpj14, effectiveName),
                    groupId: targetGroupId,
                    cnpj: cnpj14,
                    normalizedName: effectiveName,
                    uniqueKey: `${cnpj14}|${effectiveName}`,
                    role,
                    deviceId: dev.id,
                    deviceUuid: dev.deviceUuid,
                    status: 'CONFIRMED',
                    reservedAt: currentNow.toISOString(),
                    expiresAt: null,
                  },
                  sourceIp,
                );
              }
            }
          }
        }
      }

      return CnpjMigrationResponseSchema.parse({
        dryRun: request.dryRun,
        scannedDevices: allDevices.length,
        validCnpjGroups: byCnpj.size,
        consolidatedDevices,
        registeredReservations,
        anomalies: anomalies.slice(0, 500),
      });
    },
  };
}
