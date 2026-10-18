import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/);

export const ComputerRoleCodeSchema = z.enum([
  'SERVIDOR',
  'CAIXA',
  'BALANCA',
  'GARCOM',
  'ESCRITORIO',
  'COZINHA',
  'ESTOQUE',
  'RETAGUARDA',
  'PERSONALIZADO',
]);
export type ComputerRoleCode = z.infer<typeof ComputerRoleCodeSchema>;

export const RenameStatusSchema = z.enum([
  'NAO_SOLICITADO',
  'RESERVADO',
  'APLICADO_AGUARDANDO_REBOOT',
  'CONFIRMADO',
  'DIVERGENTE',
  'ERRO',
]);
export type RenameStatus = z.infer<typeof RenameStatusSchema>;

export const InstallationOperationModeSchema = z.enum([
  'NEW_INSTALL',
  'REINSTALL_SAME_DEVICE',
  'REPLACE_DEVICE',
]);
export type InstallationOperationMode = z.infer<typeof InstallationOperationModeSchema>;

export interface ComputerRoleCatalogEntry {
  code: ComputerRoleCode;
  label: string;
  prefix: string;
  exclusive: boolean;
  sampleName: string;
}

export const COMPUTER_ROLE_CATALOG: readonly ComputerRoleCatalogEntry[] = Object.freeze([
  { code: 'SERVIDOR', label: 'Servidor', prefix: 'SERVIDOR', exclusive: true, sampleName: 'SERVIDOR' },
  { code: 'CAIXA', label: 'Caixa / PDV', prefix: 'CAIXA', exclusive: false, sampleName: 'CAIXA-01' },
  { code: 'BALANCA', label: 'Balança', prefix: 'BALANCA', exclusive: false, sampleName: 'BALANCA-01' },
  { code: 'GARCOM', label: 'Estação de garçom', prefix: 'GARCOM', exclusive: false, sampleName: 'GARCOM-01' },
  { code: 'ESCRITORIO', label: 'Escritório', prefix: 'ESCRITORIO', exclusive: false, sampleName: 'ESCRITORIO-01' },
  { code: 'COZINHA', label: 'Cozinha', prefix: 'COZINHA', exclusive: false, sampleName: 'COZINHA-01' },
  { code: 'ESTOQUE', label: 'Estoque', prefix: 'ESTOQUE', exclusive: false, sampleName: 'ESTOQUE-01' },
  { code: 'RETAGUARDA', label: 'Retaguarda', prefix: 'RETAGUARDA', exclusive: false, sampleName: 'RETAGUARDA-01' },
  { code: 'PERSONALIZADO', label: 'Personalizado', prefix: '', exclusive: false, sampleName: 'PERSONALIZADO' },
]);

const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
  'LOCALHOST', 'WORKGROUP', 'DOMAIN', 'DEFAULT', 'NONE', 'NULL',
]);

export function getRoleLabel(code?: string | null): string {
  const entry = COMPUTER_ROLE_CATALOG.find((item) => item.code === code);
  return entry ? entry.label : 'Personalizado';
}

export function normalizeCnpj(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const digits = raw.replace(/\D+/g, '');
  if (digits.length !== 14) return null;
  if (/^(\d)\1{13}$/.test(digits)) return null;
  return digits;
}

export function formatCnpj(raw?: string | null): string {
  const cnpj = normalizeCnpj(raw);
  if (!cnpj) return raw?.trim() || '';
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12, 14)}`;
}

export function normalizeWindowsHostname(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 15)
    .replace(/-+$/g, '');
}

export function validateWindowsHostname(raw?: string | null): {
  valid: boolean;
  normalized: string;
  reason?: string;
} {
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    return { valid: false, normalized: '', reason: 'Informe um nome para o computador.' };
  }
  const normalized = normalizeWindowsHostname(raw);
  if (!normalized) {
    return { valid: false, normalized: '', reason: 'O nome deve conter letras A–Z ou números.' };
  }
  if (normalized.length > 15) {
    return { valid: false, normalized, reason: 'O nome Windows deve ter no máximo 15 caracteres.' };
  }
  if (!/^[A-Z0-9](?:[A-Z0-9-]{0,13}[A-Z0-9])?$/.test(normalized)) {
    return { valid: false, normalized, reason: 'Use apenas letras A–Z, números e hífen (sem iniciar ou terminar com hífen).' };
  }
  if (/^\d+$/.test(normalized)) {
    return { valid: false, normalized, reason: 'O nome Windows não pode conter apenas números.' };
  }
  if (WINDOWS_RESERVED_NAMES.has(normalized)) {
    return { valid: false, normalized, reason: `O nome ${normalized} é reservado pelo Windows.` };
  }
  return { valid: true, normalized };
}

export function inferRoleFromName(rawName?: string | null): {
  role: ComputerRoleCode;
  sequence: number | null;
  normalizedName: string;
} {
  const normalizedName = normalizeWindowsHostname(rawName);
  if (normalizedName === 'SERVIDOR') {
    return { role: 'SERVIDOR', sequence: null, normalizedName };
  }
  for (const item of COMPUTER_ROLE_CATALOG) {
    if (!item.exclusive && item.prefix) {
      const match = new RegExp(`^${item.prefix}-(\\d{1,3})$`).exec(normalizedName);
      if (match && match[1]) {
        return { role: item.code, sequence: Number.parseInt(match[1], 10), normalizedName };
      }
    }
  }
  return { role: 'PERSONALIZADO', sequence: null, normalizedName };
}

export function formatRoleSequentialName(prefix: string, index: number): string {
  const num = index < 100 ? String(index).padStart(2, '0') : String(index);
  return `${prefix}-${num}`.slice(0, 15);
}

export interface NameSuggestionResult {
  role: ComputerRoleCode;
  suggestedName: string;
  available: boolean;
  conflictName?: string;
  explanation: string;
  existingCountForRole: number;
}

export function suggestNameForRole(
  role: ComputerRoleCode,
  occupiedRawNames: Iterable<string>,
  customCandidate?: string | null,
  selfCurrentName?: string | null,
): NameSuggestionResult {
  const selfNormalized = selfCurrentName ? normalizeWindowsHostname(selfCurrentName) : '';
  const occupied = new Set<string>();
  for (const name of occupiedRawNames) {
    const norm = normalizeWindowsHostname(name);
    if (norm && norm !== selfNormalized) {
      occupied.add(norm);
    }
  }

  const catalogEntry = COMPUTER_ROLE_CATALOG.find((item) => item.code === role) ?? COMPUTER_ROLE_CATALOG[8]!;

  if (role === 'SERVIDOR') {
    const serverOccupied = occupied.has('SERVIDOR');
    if (serverOccupied) {
      return {
        role: 'SERVIDOR',
        suggestedName: 'SERVIDOR',
        available: false,
        conflictName: 'SERVIDOR',
        existingCountForRole: 1,
        explanation: 'Já existe um computador cadastrado como SERVIDOR neste CNPJ. O nome SERVIDOR é exclusivo; selecione outra função ou utilize Substituição de Computador.',
      };
    }
    return {
      role: 'SERVIDOR',
      suggestedName: 'SERVIDOR',
      available: true,
      existingCountForRole: 0,
      explanation: 'Nenhum servidor ativo cadastrado para este CNPJ. O nome exclusivo SERVIDOR está disponível.',
    };
  }

  if (role !== 'PERSONALIZADO') {
    const prefix = catalogEntry.prefix;
    let existingCountForRole = 0;
    for (const name of occupied) {
      if (new RegExp(`^${prefix}-\\d+$`).test(name)) {
        existingCountForRole++;
      }
    }
    let nextNumber = 1;
    while (occupied.has(formatRoleSequentialName(prefix, nextNumber)) && nextNumber < 999) {
      nextNumber++;
    }
    const nextAvailableName = formatRoleSequentialName(prefix, nextNumber);

    if (customCandidate && customCandidate.trim()) {
      const check = validateWindowsHostname(customCandidate);
      if (!check.valid) {
        return {
          role,
          suggestedName: nextAvailableName,
          available: false,
          existingCountForRole,
          explanation: `${check.reason} Sugerimos ${nextAvailableName}.`,
        };
      }
      if (occupied.has(check.normalized)) {
        return {
          role,
          suggestedName: nextAvailableName,
          available: false,
          conflictName: check.normalized,
          existingCountForRole,
          explanation: `O nome ${check.normalized} já pertence a outro computador deste CNPJ. Sugerimos ${nextAvailableName}.`,
        };
      }
      return {
        role,
        suggestedName: check.normalized,
        available: true,
        existingCountForRole,
        explanation: `O nome ${check.normalized} está disponível para a função ${catalogEntry.label}.`,
      };
    }

    const explanation =
      existingCountForRole === 0
        ? `Nenhum computador cadastrado como ${catalogEntry.label.toLowerCase()} nesta empresa. O primeiro nome disponível é ${nextAvailableName}.`
        : existingCountForRole === 1
          ? `Identificamos 1 computador cadastrado como ${catalogEntry.label.toLowerCase()} nesta empresa. O próximo nome disponível é ${nextAvailableName}.`
          : `Identificamos ${existingCountForRole} computadores cadastrados como ${catalogEntry.label.toLowerCase()} nesta empresa. O próximo nome disponível é ${nextAvailableName}.`;

    return {
      role,
      suggestedName: nextAvailableName,
      available: true,
      existingCountForRole,
      explanation,
    };
  }

  // PERSONALIZADO
  if (!customCandidate || !customCandidate.trim()) {
    let fallbackIndex = 1;
    while (occupied.has(formatRoleSequentialName('ESTACAO', fallbackIndex)) && fallbackIndex < 999) {
      fallbackIndex++;
    }
    const fallback = formatRoleSequentialName('ESTACAO', fallbackIndex);
    return {
      role: 'PERSONALIZADO',
      suggestedName: fallback,
      available: true,
      existingCountForRole: 0,
      explanation: `Informe um nome personalizado (até 15 caracteres, A–Z, números e hífen) ou utilize a sugestão ${fallback}.`,
    };
  }

  const validation = validateWindowsHostname(customCandidate);
  if (!validation.valid) {
    let fallbackIndex = 1;
    while (occupied.has(formatRoleSequentialName('ESTACAO', fallbackIndex)) && fallbackIndex < 999) {
      fallbackIndex++;
    }
    const fallback = formatRoleSequentialName('ESTACAO', fallbackIndex);
    return {
      role: 'PERSONALIZADO',
      suggestedName: fallback,
      available: false,
      existingCountForRole: 0,
      explanation: `${validation.reason} Sugerimos ${fallback}.`,
    };
  }

  if (occupied.has(validation.normalized)) {
    const base = validation.normalized.replace(/-\d{1,3}$/, '').slice(0, 12) || 'PC';
    let altIdx = 2;
    while (occupied.has(formatRoleSequentialName(base, altIdx)) && altIdx < 999) {
      altIdx++;
    }
    const alternative = formatRoleSequentialName(base, altIdx);
    return {
      role: 'PERSONALIZADO',
      suggestedName: alternative,
      available: false,
      conflictName: validation.normalized,
      existingCountForRole: 1,
      explanation: `O nome ${validation.normalized} já pertence a outro computador deste CNPJ. Sugerimos ${alternative}.`,
    };
  }

  return {
    role: 'PERSONALIZADO',
    suggestedName: validation.normalized,
    available: true,
    existingCountForRole: 0,
    explanation: `O nome personalizado ${validation.normalized} é válido e está disponível neste CNPJ.`,
  };
}

export const ExistingCompanyComputerSchema = z.object({
  deviceId: z.string().min(1).max(36),
  deviceUuid: z.string().min(1).max(64),
  displayName: z.string().min(1).max(128),
  windowsHostnameAtual: z.string().min(1).max(255),
  windowsHostnameDesejado: z.string().min(1).max(64).nullable(),
  role: ComputerRoleCodeSchema,
  roleLabel: z.string().min(1).max(64),
  rustdeskId: z.string().min(1).max(64),
  status: z.enum(['ONLINE', 'OFFLINE', 'RESERVED', 'DISABLED']),
  renameStatus: RenameStatusSchema,
  lastSeenAt: z.iso.datetime({ offset: true }).nullable(),
  isCurrentMachine: z.boolean(),
}).strict();
export type ExistingCompanyComputer = z.infer<typeof ExistingCompanyComputerSchema>;

export const CatalogRoleOptionSchema = z.object({
  code: ComputerRoleCodeSchema,
  label: z.string().min(1).max(64),
  exclusive: z.boolean(),
  suggestedName: z.string().min(1).max(15),
  available: z.boolean(),
  explanation: z.string().min(1).max(512),
}).strict();
export type CatalogRoleOption = z.infer<typeof CatalogRoleOptionSchema>;

export const InstallationContextRequestSchema = z.object({
  installerId: id,
  cnpj: z.string().min(1).max(32),
  razaoSocial: z.string().max(160).optional(),
  nomeFantasia: z.string().max(160).optional(),
  serial: z.string().max(128).optional(),
  deviceUuid: z.string().max(64).optional(),
  rustdeskId: z.string().max(64).optional(),
  currentWindowsHostname: z.string().max(255).optional(),
}).strict();
export type InstallationContextRequest = z.infer<typeof InstallationContextRequestSchema>;

export const InstallationContextResponseSchema = z.object({
  groupId: id,
  organizationName: z.string().min(1).max(128),
  cnpj: z.string().length(14),
  formattedCnpj: z.string().min(14).max(20),
  razaoSocial: z.string().max(160).nullable(),
  nomeFantasia: z.string().max(160).nullable(),
  totalComputers: z.number().int().min(0),
  operationMode: InstallationOperationModeSchema,
  matchedDeviceId: z.string().max(36).nullable(),
  hasServer: z.boolean(),
  computers: z.array(ExistingCompanyComputerSchema).max(200),
  catalog: z.array(CatalogRoleOptionSchema).max(20),
  recommendedRole: ComputerRoleCodeSchema,
  recommendedName: z.string().min(1).max(15),
  recommendationExplanation: z.string().min(1).max(512),
  currentHostnameValidAndAvailable: z.boolean(),
}).strict();
export type InstallationContextResponse = z.infer<typeof InstallationContextResponseSchema>;

export const SuggestNameRequestSchema = z.object({
  installerId: id.optional(),
  cnpj: z.string().min(1).max(32),
  role: ComputerRoleCodeSchema,
  customName: z.string().max(64).optional(),
  deviceUuid: z.string().max(64).optional(),
  replaceDeviceId: z.string().max(36).optional(),
}).strict();
export type SuggestNameRequest = z.infer<typeof SuggestNameRequestSchema>;

export const SuggestNameResponseSchema = z.object({
  role: ComputerRoleCodeSchema,
  roleLabel: z.string().min(1).max(64),
  suggestedName: z.string().min(1).max(15),
  available: z.boolean(),
  conflictName: z.string().max(64).optional(),
  explanation: z.string().min(1).max(512),
}).strict();
export type SuggestNameResponse = z.infer<typeof SuggestNameResponseSchema>;

export const ReserveNameRequestSchema = z.object({
  installerId: id,
  cnpj: z.string().min(1).max(32),
  razaoSocial: z.string().max(160).optional(),
  nomeFantasia: z.string().max(160).optional(),
  serial: z.string().max(128).optional(),
  role: ComputerRoleCodeSchema,
  desiredName: z.string().min(1).max(64),
  deviceUuid: z.string().max(64).optional(),
  rustdeskId: z.string().max(64).optional(),
  currentWindowsHostname: z.string().max(255).optional(),
  operationMode: InstallationOperationModeSchema.optional(),
  replaceDeviceId: z.string().max(36).optional(),
}).strict();
export type ReserveNameRequest = z.infer<typeof ReserveNameRequestSchema>;

export const ReserveNameResponseSchema = z.object({
  reserved: z.boolean(),
  reservationId: z.string().max(64).nullable(),
  uniqueKey: z.string().max(64).nullable(),
  groupId: id,
  organizationName: z.string().min(1).max(128),
  cnpj: z.string().length(14),
  role: ComputerRoleCodeSchema,
  normalizedName: z.string().min(1).max(15),
  operationMode: InstallationOperationModeSchema,
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  conflictName: z.string().max(64).optional(),
  suggestedAlternative: z.string().max(15).optional(),
  explanation: z.string().min(1).max(512),
}).strict();
export type ReserveNameResponse = z.infer<typeof ReserveNameResponseSchema>;

export const ConfirmNameRequestSchema = z.object({
  installerId: id.optional(),
  cnpj: z.string().min(1).max(32),
  deviceUuid: z.string().min(1).max(64),
  reservationId: z.string().max(64).optional(),
  desiredName: z.string().min(1).max(15),
  actualWindowsHostname: z.string().min(1).max(255),
  role: ComputerRoleCodeSchema.optional(),
  renameApplied: z.boolean(),
  rebootRequired: z.boolean(),
  errorDetail: z.string().max(255).optional(),
}).strict();
export type ConfirmNameRequest = z.infer<typeof ConfirmNameRequestSchema>;

export const ConfirmNameResponseSchema = z.object({
  confirmed: z.literal(true),
  statusRenomeacao: RenameStatusSchema,
  windowsHostnameAtual: z.string().min(1).max(255),
  windowsHostnameDesejado: z.string().min(1).max(15),
}).strict();
export type ConfirmNameResponse = z.infer<typeof ConfirmNameResponseSchema>;

export const ReleaseNameRequestSchema = z.object({
  installerId: id.optional(),
  cnpj: z.string().min(1).max(32),
  desiredName: z.string().min(1).max(64),
  deviceUuid: z.string().max(64).optional(),
  reservationId: z.string().max(64).optional(),
}).strict();
export type ReleaseNameRequest = z.infer<typeof ReleaseNameRequestSchema>;

export const ReleaseNameResponseSchema = z.object({
  released: z.boolean(),
  uniqueKey: z.string().max(64),
}).strict();
export type ReleaseNameResponse = z.infer<typeof ReleaseNameResponseSchema>;

export const DeviceSyncRequestSchema = z.object({
  deviceUuid: z.string().min(1).max(64),
  windowsHostnameAtual: z.string().min(1).max(255),
  rustdeskId: z.string().min(1).max(64),
  agentVersion: z.string().max(64).optional(),
  cnpj: z.string().max(32).optional(),
}).strict();
export type DeviceSyncRequest = z.infer<typeof DeviceSyncRequestSchema>;

export const DeviceSyncResponseSchema = z.object({
  synced: z.literal(true),
  deviceId: z.string().min(1).max(36),
  statusRenomeacao: RenameStatusSchema,
  windowsHostnameDesejado: z.string().max(64).nullable(),
}).strict();
export type DeviceSyncResponse = z.infer<typeof DeviceSyncResponseSchema>;

export const NamingReservationRecordSchema = z.object({
  id: z.string().min(1).max(36),
  groupId: id,
  cnpj: z.string().length(14),
  normalizedName: z.string().min(1).max(15),
  uniqueKey: z.string().min(16).max(32),
  role: ComputerRoleCodeSchema,
  deviceId: z.string().max(36).nullable(),
  deviceUuid: z.string().max(64).nullable(),
  status: z.enum(['RESERVED', 'AWAITING_REBOOT', 'CONFIRMED', 'RELEASED']),
  reservedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
}).strict();
export type NamingReservationRecord = z.infer<typeof NamingReservationRecordSchema>;

export const NamingHistoryEventSchema = z.object({
  id: z.string().min(1).max(36),
  at: z.iso.datetime({ offset: true }),
  groupId: id,
  cnpj: z.string().length(14),
  deviceId: z.string().max(36).nullable(),
  deviceUuid: z.string().max(64).nullable(),
  eventType: z.enum([
    'GROUP_CREATED',
    'COMPUTER_IDENTIFIED',
    'NAME_RESERVED',
    'RENAME_ATTEMPTED',
    'RENAME_COMPLETED',
    'RENAME_FAILED',
    'REBOOT_PENDING',
    'NAME_CONFLICT',
    'NAME_TRANSFERRED',
    'NAME_RELEASED',
    'ROLE_UPDATED',
    'MIGRATION_CONSOLIDATED',
  ]),
  normalizedName: z.string().max(64).nullable(),
  role: ComputerRoleCodeSchema.nullable(),
  operatorId: z.string().max(64).nullable(),
  result: z.enum(['success', 'failure']),
  detail: z.string().max(512).nullable(),
}).strict();
export type NamingHistoryEvent = z.infer<typeof NamingHistoryEventSchema>;

export const CnpjCompanyGroupViewSchema = z.object({
  groupId: id,
  organizationName: z.string().min(1).max(128),
  cnpj: z.string().length(14),
  formattedCnpj: z.string().min(14).max(20),
  razaoSocial: z.string().max(160).nullable(),
  nomeFantasia: z.string().max(160).nullable(),
  totalComputers: z.number().int().min(0),
  onlineComputers: z.number().int().min(0),
  pendingRenameCount: z.number().int().min(0),
  conflictCount: z.number().int().min(0),
  hasServer: z.boolean(),
  computers: z.array(ExistingCompanyComputerSchema).max(200),
  reservations: z.array(NamingReservationRecordSchema).max(200),
  history: z.array(NamingHistoryEventSchema).max(100),
}).strict();
export type CnpjCompanyGroupView = z.infer<typeof CnpjCompanyGroupViewSchema>;

export const CnpjGroupsListResponseSchema = z.object({
  groups: z.array(CnpjCompanyGroupViewSchema).max(200),
}).strict();
export type CnpjGroupsListResponse = z.infer<typeof CnpjGroupsListResponseSchema>;

export const AdminCnpjNamingActionRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('UPDATE_ROLE_AND_NAME'),
    cnpj: z.string().min(1).max(32),
    deviceId: id,
    role: ComputerRoleCodeSchema,
    desiredName: z.string().min(1).max(15),
  }).strict(),
  z.object({
    action: z.literal('RELEASE_NAME'),
    cnpj: z.string().min(1).max(32),
    normalizedName: z.string().min(1).max(15),
    deviceId: id.optional(),
  }).strict(),
  z.object({
    action: z.literal('TRANSFER_NAME'),
    cnpj: z.string().min(1).max(32),
    fromDeviceId: id,
    toDeviceId: id,
  }).strict(),
]);
export type AdminCnpjNamingActionRequest = z.infer<typeof AdminCnpjNamingActionRequestSchema>;

export const CnpjMigrationRequestSchema = z.object({
  dryRun: z.boolean().default(true),
}).strict();
export type CnpjMigrationRequest = z.infer<typeof CnpjMigrationRequestSchema>;

export const CnpjMigrationAnomalySchema = z.object({
  type: z.enum(['DUPLICATE_NAME_IN_CNPJ', 'MISSING_CNPJ', 'MULTIPLE_SERVERS_IN_CNPJ', 'HOSTNAME_DISPLAY_MISMATCH', 'CONSOLIDATED_ORGANIZATION']),
  cnpj: z.string().max(32).nullable(),
  deviceId: z.string().max(36),
  displayName: z.string().max(128),
  hostname: z.string().max(255),
  detail: z.string().max(512),
}).strict();
export type CnpjMigrationAnomaly = z.infer<typeof CnpjMigrationAnomalySchema>;

export const CnpjMigrationResponseSchema = z.object({
  dryRun: z.boolean(),
  scannedDevices: z.number().int().min(0),
  validCnpjGroups: z.number().int().min(0),
  consolidatedDevices: z.number().int().min(0),
  registeredReservations: z.number().int().min(0),
  anomalies: z.array(CnpjMigrationAnomalySchema).max(500),
}).strict();
export type CnpjMigrationResponse = z.infer<typeof CnpjMigrationResponseSchema>;
