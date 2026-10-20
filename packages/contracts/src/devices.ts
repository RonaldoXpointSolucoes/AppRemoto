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
