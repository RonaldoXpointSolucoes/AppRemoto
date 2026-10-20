import { z } from 'zod';
import { DataDivasInfoSchema, type DataDivasInfo } from './agent.ts';

const shortId = z.string().min(1).max(36);
const deviceStatus = z.enum(['ONLINE', 'OFFLINE']);

export const DeviceListQuerySchema = z.object({
  organizationId: shortId.optional(),
  status: deviceStatus.optional(),
  search: z.string().trim().min(1).max(128).optional(),
  cursor: z.string().min(1).max(1024).optional(),
  limit: z.preprocess(
    (value) => typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value,
    z.number().int().min(1).max(100),
  ).default(50),
}).strict();

export const DeviceViewSchema = z.object({
  id: shortId,
  createdAt: z.iso.datetime({ offset: true }).optional(),
  organizationId: shortId,
  organizationName: z.string().min(1).max(128),
  deviceUuid: z.uuid(),
  displayName: z.string().min(1).max(128),
  hostname: z.string().min(1).max(255),
  operatingSystem: z.string().min(1).max(64),
  osVersion: z.string().min(1).max(128),
  rustdeskId: z.string().min(1).max(64),
  agentVersion: z.string().min(1).max(64).nullable(),
  rustdeskVersion: z.string().min(1).max(64).nullable(),
  lastSeenAt: z.iso.datetime({ offset: true }).nullable(),
  enabled: z.boolean(),
  status: deviceStatus,
  datadivas: DataDivasInfoSchema.optional(),
  notes: z.string().max(2048).optional(),
  requiresAccessPassword: z.boolean().optional(),
  adminOnlyAccess: z.boolean().optional(),
  customDisplayName: z.boolean().optional(),
}).strict();

export type DeviceListQuery = z.infer<typeof DeviceListQuerySchema>;
export type DeviceView = z.infer<typeof DeviceViewSchema>;

const DATADIVAS_KEYS: (keyof DataDivasInfo)[] = [
  'nomeFantasia',
  'razaoSocial',
  'cnpj',
  'serial',
  'ie',
  'endereco',
  'cidade',
  'uf',
  'nomeMaq',
  'ipMaq',
  'ipDataDivas',
  'banco',
  'funcao',
  'windowsHostnameDesejado',
  'statusRenomeacao',
  'erroRenomeacao',
  'ultimaSincronizacao',
  'reservaId',
  'substituiuDeviceId',
];

const DATADIVAS_TAG_REGEX = /\n?\[datadivas_b64:([A-Za-z0-9_-]+)\]\s*$/;

function toBase64Url(utf8Text: string): string {
  const bytes = new TextEncoder().encode(utf8Text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(b64url: string): string {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function normalizeDataDivasInfo(input?: DataDivasInfo | null): DataDivasInfo | null {
  if (!input) return null;
  const out: DataDivasInfo = {};
  let hasField = false;
  for (const key of DATADIVAS_KEYS) {
    const raw = input[key];
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed) {
        out[key] = trimmed;
        hasField = true;
      }
    }
  }
  return hasField ? out : null;
}

export function extractDataDivasFromNotes(rawNotes?: string | null): {
  datadivas: DataDivasInfo | null;
  cleanNotes: string;
} {
  if (!rawNotes) return { datadivas: null, cleanNotes: '' };
  const match = DATADIVAS_TAG_REGEX.exec(rawNotes);
  if (!match || !match[1]) {
    return { datadivas: null, cleanNotes: rawNotes };
  }
  const cleanNotes = rawNotes.slice(0, match.index);
  try {
    const decoded = fromBase64Url(match[1]);
    const parsed = DataDivasInfoSchema.safeParse(JSON.parse(decoded));
    if (parsed.success) {
      return { datadivas: normalizeDataDivasInfo(parsed.data), cleanNotes };
    }
  } catch {
    // Ignore malformed tag and keep clean notes
  }
  return { datadivas: null, cleanNotes };
}

export function mergeDataDivasIntoNotes(
  existingRawNotes: string | null | undefined,
  incoming?: DataDivasInfo | null
): string | null {
  const { datadivas: prevDataDivas, cleanNotes } = extractDataDivasFromNotes(existingRawNotes);
  const normalizedIncoming = normalizeDataDivasInfo(incoming);
  const merged = prevDataDivas && normalizedIncoming
    ? normalizeDataDivasInfo({ ...prevDataDivas, ...normalizedIncoming })
    : (normalizedIncoming ?? prevDataDivas);
  if (!merged) {
    return existingRawNotes ?? null;
  }
  const tag = `[datadivas_b64:${toBase64Url(JSON.stringify(merged))}]`;
  const trimmedClean = cleanNotes.trimEnd();
  if (!trimmedClean) {
    return tag.length <= 2048 ? tag : existingRawNotes ?? null;
  }
  const maxClean = Math.max(0, 2048 - tag.length - 1);
  return `${trimmedClean.slice(0, maxClean)}\n${tag}`;
}

export interface DeviceAccessPolicy {
  folderName?: string;
  adminOnlyAccess: boolean;
  requiresAccessPassword: boolean;
  accessPasswordHash: string | null;
  customDisplayName?: boolean;
  cleanNotes: string;
}

export function hashDeviceAccessPassword(password: string): string {
  const normalized = `xpoint-access-v1:${password.trim()}`;
  const bytes = new TextEncoder().encode(normalized);
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  return seeds
    .map((seed, idx) => {
      let h = seed >>> 0;
      for (let i = 0; i < bytes.length; i++) {
        h ^= (bytes[i]! + idx * 31) & 0xff;
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h.toString(16).padStart(8, '0');
    })
    .join('');
}

export function verifyDeviceAccessPassword(password: string, expectedHash?: string | null): boolean {
  if (!expectedHash || !password.trim()) return false;
  return hashDeviceAccessPassword(password) === expectedHash.trim();
}

export function extractDeviceAccessPolicy(rawNotes?: string | null): DeviceAccessPolicy {
  if (!rawNotes) {
    return {
      adminOnlyAccess: false,
      requiresAccessPassword: false,
      accessPasswordHash: null,
      cleanNotes: '',
    };
  }
  const { cleanNotes: withoutDataDivas } = extractDataDivasFromNotes(rawNotes);
  let rest = withoutDataDivas;
  let folderName: string | undefined;
  let adminOnlyAccess = false;
  let accessPasswordHash: string | null = null;
  let customDisplayName = false;

  const prefixRegex = /^\s*\[([a-z_]+):([^\]]+)\]\s*/i;
  let safety = 0;
  while (safety++ < 10) {
    const m = prefixRegex.exec(rest);
    if (!m) break;
    const key = (m[1] || '').toLowerCase();
    const val = (m[2] || '').trim();
    if (key === 'pasta') {
      if (val) folderName = val;
      rest = rest.slice(m[0].length);
      continue;
    }
    if (key === 'acesso_admin') {
      adminOnlyAccess = val === '1' || val.toLowerCase() === 'true';
      rest = rest.slice(m[0].length);
      continue;
    }
    if (key === 'senha_acesso') {
      if (val) accessPasswordHash = val;
      rest = rest.slice(m[0].length);
      continue;
    }
    if (key === 'nome_editado') {
      customDisplayName = val === '1' || val.toLowerCase() === 'true';
      rest = rest.slice(m[0].length);
      continue;
    }
    break;
  }

  return {
    ...(folderName ? { folderName } : {}),
    adminOnlyAccess,
    requiresAccessPassword: Boolean(accessPasswordHash),
    accessPasswordHash,
    ...(customDisplayName ? { customDisplayName: true } : {}),
    cleanNotes: rest.trim(),
  };
}

export function encodeDeviceAccessNotes(input: {
  folderName?: string;
  adminOnlyAccess?: boolean;
  accessPasswordHash?: string | null;
  customDisplayName?: boolean;
  notes?: string;
}): string {
  const tags: string[] = [];
  if (input.folderName && input.folderName.trim()) {
    tags.push(`[pasta:${input.folderName.trim()}]`);
  }
  if (input.adminOnlyAccess) {
    tags.push(`[acesso_admin:1]`);
  }
  if (input.accessPasswordHash && input.accessPasswordHash.trim()) {
    tags.push(`[senha_acesso:${input.accessPasswordHash.trim()}]`);
  }
  if (input.customDisplayName) {
    tags.push(`[nome_editado:1]`);
  }
  const cleanNotes = (input.notes || '').trim();
  if (tags.length > 0) {
    return `${tags.join('')}${cleanNotes ? '\n' + cleanNotes : ''}`;
  }
  return cleanNotes;
}
