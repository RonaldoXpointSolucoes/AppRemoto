import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { DeviceViewSchema, extractDataDivasFromNotes, extractDeviceAccessPolicy, type DataDivasInfo, type DeviceListQuery, type DeviceView } from '@appremoto/contracts';

import type { AuthenticatedTechnician } from '../plugins/technician-auth.ts';
import type { DeviceRecord, DeviceRepository } from '../repositories/devices.ts';

export function normalizeRustDeskIdKey(rawId?: string | null): string {
  if (!rawId) return '';
  const trimmed = rawId.trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/\D+/g, '');
  if (digits.length >= 6 && /^[\d\s.-]+$/.test(trimmed)) {
    return digits;
  }
  return trimmed.toLowerCase();
}

function isGenericOrAutoDisplayName(name: string, rustdeskId?: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  const rdDigits = (rustdeskId ?? '').replace(/\D+/g, '');
  const nameDigits = trimmed.replace(/\D+/g, '');
  if (rdDigits.length >= 6 && nameDigits === rdDigits) {
    return true;
  }
  if (/^((DESKTOP|WIN|LAPTOP|WORKSTATION|PC|COMPUTADOR|MAQUINA)[-_\s]|[A-Z0-9À-Ú]+\s*-\s*PC$)/i.test(trimmed)) {
    return true;
  }
  return false;
}

export function scoreDeviceForDeduplication(dev: DeviceView): number {
  let score = 0;
  const policy = extractDeviceAccessPolicy(dev.notes);
  if (dev.customDisplayName || policy.customDisplayName) {
    score += 1000;
  }
  if (dev.status === 'ONLINE') {
    score += 200;
  }
  if (dev.enabled !== false) {
    score += 50;
  }
  const dd = dev.datadivas;
  if (dd?.cnpj?.trim()) score += 80;
  if (dd?.razaoSocial?.trim() || dd?.nomeFantasia?.trim()) score += 60;
  if (dd?.funcao?.trim()) score += 50;
  if (dd?.ipMaq?.trim()) score += 20;
  if (dev.notes && /\[pasta:[^\]]+\]/i.test(dev.notes)) {
    score += 40;
  }
  if (dev.requiresAccessPassword || policy.requiresAccessPassword || dev.adminOnlyAccess || policy.adminOnlyAccess) {
    score += 30;
  }
  const display = (dev.displayName || '').trim();
  if (display && !isGenericOrAutoDisplayName(display, dev.rustdeskId)) {
    score += 35;
    if (/^[A-Z0-9À-Ú]+(?:-[A-Z0-9À-Ú]+)+$/.test(display) && display === display.toUpperCase()) {
      score += 25;
    }
  }
  return score;
}

function pickNewerIso(a?: string | null, b?: string | null): string | null {
  const msA = a ? Date.parse(a) : NaN;
  const msB = b ? Date.parse(b) : NaN;
  if (Number.isFinite(msA) && Number.isFinite(msB)) {
    return msA >= msB ? a! : b!;
  }
  if (Number.isFinite(msA)) return a!;
  if (Number.isFinite(msB)) return b!;
  return a ?? b ?? null;
}

function mergeCleanNotes(primaryNotes?: string | null, secondaryNotes?: string | null): string | undefined {
  const p = (primaryNotes ?? '').trim();
  const s = (secondaryNotes ?? '').trim();
  if (!p && !s) return undefined;
  if (!s) return p;
  if (!p) return s;

  let merged = p;
  const secFolder = /\[pasta:[^\]]+\]/i.exec(s);
  if (secFolder && !/\[pasta:[^\]]+\]/i.test(merged)) {
    merged = `${secFolder[0]} ${merged}`.trim();
  }
  const secAccess = /\[acesso:\{[^\]]*\}\]/i.exec(s);
  if (secAccess && !/\[acesso:\{[^\]]*\}\]/i.test(merged)) {
    merged = `${secAccess[0]} ${merged}`.trim();
  }
  return merged.slice(0, 2000);
}

export function mergeDuplicateDeviceViews(a: DeviceView, b: DeviceView): DeviceView {
  const scoreA = scoreDeviceForDeduplication(a);
  const scoreB = scoreDeviceForDeduplication(b);
  let primary = a;
  let secondary = b;
  if (scoreB > scoreA) {
    primary = b;
    secondary = a;
  } else if (scoreB === scoreA) {
    const createdA = a.createdAt ? Date.parse(a.createdAt) : NaN;
    const createdB = b.createdAt ? Date.parse(b.createdAt) : NaN;
    if (Number.isFinite(createdB) && (!Number.isFinite(createdA) || createdB > createdA)) {
      primary = b;
      secondary = a;
    } else if (!Number.isFinite(createdA) && !Number.isFinite(createdB)) {
      const seenA = a.lastSeenAt ? Date.parse(a.lastSeenAt) : NaN;
      const seenB = b.lastSeenAt ? Date.parse(b.lastSeenAt) : NaN;
      if (Number.isFinite(seenB) && (!Number.isFinite(seenA) || seenB > seenA)) {
        primary = b;
        secondary = a;
      }
    }
  }

  const mergedCreatedAt = pickNewerIso(primary.createdAt, secondary.createdAt);
  const mergedLastSeenAt = pickNewerIso(primary.lastSeenAt, secondary.lastSeenAt);
  const mergedStatus: DeviceView['status'] =
    primary.status === 'ONLINE' || secondary.status === 'ONLINE' ? 'ONLINE' : primary.status;

  let mergedHostname = primary.hostname;
  if (
    (!mergedHostname || mergedHostname.trim().toUpperCase() === primary.displayName.trim().toUpperCase()) &&
    secondary.hostname &&
    secondary.hostname.trim().toUpperCase() !== secondary.displayName.trim().toUpperCase()
  ) {
    mergedHostname = secondary.hostname;
  }

  let mergedOsVersion = primary.osVersion;
  if (!mergedOsVersion.includes('IP ') && secondary.osVersion.includes('IP ')) {
    mergedOsVersion = secondary.osVersion;
  }

  let mergedDataDivas: DataDivasInfo | undefined;
  if (primary.datadivas || secondary.datadivas) {
    const combined: Record<string, unknown> = { ...(secondary.datadivas ?? {}) };
    for (const [key, val] of Object.entries(primary.datadivas ?? {})) {
      if (val !== undefined && val !== '') {
        combined[key] = val;
      }
    }
    mergedDataDivas = combined as DataDivasInfo;
  }

  const mergedNotes = mergeCleanNotes(primary.notes, secondary.notes);
  const mergedPublicIp = primary.publicIp || secondary.publicIp;
  const requiresAccessPassword = Boolean(primary.requiresAccessPassword || secondary.requiresAccessPassword);
  const adminOnlyAccess = Boolean(primary.adminOnlyAccess || secondary.adminOnlyAccess);
  const customDisplayName = Boolean(primary.customDisplayName || secondary.customDisplayName);

  return DeviceViewSchema.parse({
    ...primary,
    ...(mergedCreatedAt ? { createdAt: mergedCreatedAt } : {}),
    hostname: mergedHostname,
    osVersion: mergedOsVersion,
    agentVersion: primary.agentVersion ?? secondary.agentVersion,
    rustdeskVersion: primary.rustdeskVersion ?? secondary.rustdeskVersion,
    lastSeenAt: mergedLastSeenAt,
    ...(mergedPublicIp ? { publicIp: mergedPublicIp } : {}),
    enabled: Boolean(primary.enabled || secondary.enabled),
    status: mergedStatus,
    ...(mergedDataDivas ? { datadivas: mergedDataDivas } : {}),
    ...(mergedNotes ? { notes: mergedNotes } : {}),
    ...(requiresAccessPassword ? { requiresAccessPassword: true } : {}),
    ...(adminOnlyAccess ? { adminOnlyAccess: true } : {}),
    ...(customDisplayName ? { customDisplayName: true } : {}),
  });
}

export interface DevicePage {
  devices: DeviceView[];
  nextCursor: string | null;
}

export class InvalidDeviceCursorError extends Error {}

const batchSize = 25;
const rawPageSize = 99;
const maxScannedPerRequest = 500;
const maxQueriesPerRequest = 5;

interface CursorState {
  v: 1;
  t: string;
  b: number;
  k: string | null;
  f: string;
}

function validSeenAt(value: string | null): number {
  if (!value || !DeviceViewSchema.shape.lastSeenAt.safeParse(value).success) return NaN;
  return Date.parse(value);
}

function viewOf(record: DeviceRecord, organizationName: string, snapshotTime: string,
  currentRequestTime: Date): DeviceView {
  const seen = validSeenAt(record.lastSeenAt);
  const snapshotAt = Date.parse(snapshotTime);
  const snapshotAge = snapshotAt - seen;
  const currentAge = currentRequestTime.getTime() - seen;
  const online = record.enabled && Number.isFinite(seen) && seen <= currentRequestTime.getTime() &&
    (seen > snapshotAt ? currentAge <= 90_000 : snapshotAge >= 0 && snapshotAge <= 90_000);
  const { datadivas, cleanNotes } = extractDataDivasFromNotes(record.notes);
  const policy = extractDeviceAccessPolicy(cleanNotes);
  return DeviceViewSchema.parse({
    id: record.id, ...(record.createdAt ? { createdAt: record.createdAt } : {}), organizationId: record.organizationId, organizationName,
    deviceUuid: record.deviceUuid, displayName: record.displayName, hostname: record.hostname,
    operatingSystem: record.operatingSystem, osVersion: record.osVersion,
    rustdeskId: record.rustdeskId, agentVersion: record.agentVersion,
    rustdeskVersion: record.rustdeskVersion,
    lastSeenAt: Number.isFinite(seen) ? new Date(seen).toISOString() : null,
    ...(record.publicIp ? { publicIp: record.publicIp } : {}),
    enabled: record.enabled,
    status: online ? 'ONLINE' : 'OFFLINE',
    ...(datadivas ? { datadivas } : {}),
    ...(cleanNotes ? { notes: cleanNotes } : {}),
    ...(policy.requiresAccessPassword ? { requiresAccessPassword: true } : {}),
    ...(policy.adminOnlyAccess ? { adminOnlyAccess: true } : {}),
    ...(policy.customDisplayName ? { customDisplayName: true } : {}),
  });
}

function fingerprint(organizationIds: string[], selectedIds: string[], query: DeviceListQuery): string {
  return createHash('sha256').update(JSON.stringify({ organizationIds, selectedIds,
    organizationId: query.organizationId, status: query.status,
    search: query.search?.toLocaleLowerCase(), limit: query.limit })).digest('base64url');
}

function sign(payload: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function encodeCursor(state: CursorState, secret: Buffer): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

function decodeCursor(cursor: string, secret: Buffer, expectedFingerprint: string,
  batchCount: number, now: Date): CursorState {
  const parts = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(cursor);
  if (!parts) throw new InvalidDeviceCursorError();
  const [, payload, signature] = parts;
  const actual = Buffer.from(signature, 'base64url');
  const expected = Buffer.from(sign(payload, secret), 'base64url');
  if (actual.toString('base64url') !== signature ||
      actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new InvalidDeviceCursorError();
  }
  let state: CursorState;
  try { state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as CursorState; }
  catch { throw new InvalidDeviceCursorError(); }
  if (!state || state.v !== 1 || state.f !== expectedFingerprint ||
      !Number.isInteger(state.b) || state.b < 0 || state.b >= batchCount ||
      (state.k !== null && (typeof state.k !== 'string' || !state.k.length || state.k.length > 36)) ||
      typeof state.t !== 'string' || !Number.isFinite(Date.parse(state.t)) ||
      new Date(state.t).toISOString() !== state.t || Date.parse(state.t) > now.getTime() ||
      Buffer.from(JSON.stringify(state)).toString('base64url') !== payload) {
    throw new InvalidDeviceCursorError();
  }
  return state;
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}

function matchesDeviceSearch(view: DeviceView, rawSearch?: string): boolean {
  if (!rawSearch) return true;
  const trimmed = rawSearch.trim();
  if (!trimmed) return true;

  const dd = view.datadivas;
  const nameFields = [
    view.displayName,
    view.hostname,
    dd?.nomeMaq,
    dd?.windowsHostnameDesejado,
    dd?.funcao,
  ].filter(Boolean) as string[];

  const ipFields = [
    view.publicIp,
    view.osVersion,
    dd?.ipMaq,
    dd?.ipDataDivas,
    dd?.redeSubrede,
    dd?.redeGateway,
  ].filter(Boolean) as string[];

  const razaoFields = [
    dd?.razaoSocial,
    dd?.nomeFantasia,
    view.organizationName,
    dd?.cidade,
    dd?.uf,
    dd?.endereco,
  ].filter(Boolean) as string[];

  const idFields = [
    view.rustdeskId,
    dd?.cnpj,
    dd?.serial,
    dd?.ie,
  ].filter(Boolean) as string[];

  const allValues = [
    ...nameFields,
    ...ipFields,
    ...razaoFields,
    ...idFields,
    view.operatingSystem,
    view.notes,
  ].filter(Boolean) as string[];

  const fullHaystack = normalizeSearchText(allValues.join(' '));
  const nameHaystack = normalizeSearchText(nameFields.join(' '));
  const ipHaystack = normalizeSearchText(ipFields.join(' '));
  const razaoHaystack = normalizeSearchText(razaoFields.join(' '));
  const idHaystack = normalizeSearchText(idFields.join(' '));
  const digitValues = allValues.map((v) => v.replace(/\D+/g, '')).filter(Boolean);

  const clauses = normalizeSearchText(trimmed)
    .split(/[,;|]+/)
    .map((c) => c.trim())
    .filter(Boolean);

  if (clauses.length === 0) return true;

  return clauses.some((clause) => {
    if (fullHaystack.includes(clause)) return true;

    const clauseDigits = clause.replace(/\D+/g, '');
    const isNumericLike = clauseDigits.length >= 3 && /^[\d\s.:\-/]+$/.test(clause) && !clause.includes('.');
    if (
      (clauseDigits.length >= 6 || isNumericLike) &&
      digitValues.some((d) => d.includes(clauseDigits))
    ) {
      return true;
    }

    const tokens = clause.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;

    return tokens.every((tok) => {
      const colonIdx = tok.indexOf(':');
      if (colonIdx > 0) {
        const prefix = tok.slice(0, colonIdx);
        const val = tok.slice(colonIdx + 1);
        if (!val) return true;
        if (prefix === 'nome' || prefix === 'host' || prefix === 'pc' || prefix === 'funcao') {
          return nameHaystack.includes(val) || razaoHaystack.includes(val);
        }
        if (prefix === 'ip' || prefix === 'rede' || prefix === 'lan' || prefix === 'wan') {
          return ipHaystack.includes(val);
        }
        if (prefix === 'razao' || prefix === 'fantasia' || prefix === 'empresa' || prefix === 'cliente') {
          return razaoHaystack.includes(val) || nameHaystack.includes(val);
        }
        if (prefix === 'id' || prefix === 'cnpj' || prefix === 'serial') {
          const valDigits = val.replace(/\D+/g, '');
          return (
            idHaystack.includes(val) ||
            (valDigits.length >= 3 && digitValues.some((d) => d.includes(valDigits)))
          );
        }
      }

      if (fullHaystack.includes(tok)) return true;
      const tokDigits = tok.replace(/\D+/g, '');
      if (tokDigits.length >= 4 && digitValues.some((d) => d.includes(tokDigits))) {
        return true;
      }
      return false;
    });
  });
}

export async function listDevices(technician: AuthenticatedTechnician, query: DeviceListQuery,
  repository: DeviceRepository, now: Date, cursorSecret: Buffer): Promise<DevicePage> {
  const visible = new Map(technician.organizations
    .filter((organization) => technician.authorization.some((permission) =>
      permission.organizationId === organization.id && permission.canView))
    .map((organization) => [organization.id, organization]));
  const organizationIds = [...visible.keys()].sort();
  if (query.organizationId && !visible.has(query.organizationId)) return { devices: [], nextCursor: null };
  const selectedIds = query.organizationId ? [query.organizationId] : organizationIds;
  const batches: string[][] = [];
  for (let index = 0; index < selectedIds.length; index += batchSize) {
    batches.push(selectedIds.slice(index, index + batchSize));
  }
  if (!batches.length) {
    if (query.cursor) throw new InvalidDeviceCursorError();
    return { devices: [], nextCursor: null };
  }

  const expectedFingerprint = fingerprint(organizationIds, selectedIds, query);
  const state: CursorState = query.cursor
    ? decodeCursor(query.cursor, cursorSecret, expectedFingerprint, batches.length, now)
    : { v: 1, t: now.toISOString(), b: 0, k: null, f: expectedFingerprint };
  const devices: DeviceView[] = [];
  const indexByRustdeskKey = new Map<string, number>();
  let scanned = 0;
  let queries = 0;

  while (state.b < batches.length && scanned < maxScannedPerRequest && queries < maxQueriesPerRequest) {
    const size = Math.min(rawPageSize, maxScannedPerRequest - scanned);
    const batch = batches[state.b]!;
    const page = await repository.scan(batch, state.k, state.t, size);
    queries++;
    if (page.records.length > size || (page.hasMore && page.records.length === 0)) {
      throw new Error('Invalid device scan page');
    }
    for (let index = 0; index < page.records.length; index++) {
      const record = page.records[index]!;
      if (!batch.includes(record.organizationId) || record.createdAt > state.t ||
          (state.k !== null && record.id <= state.k)) throw new Error('Invalid device scan record');
      state.k = record.id;
      scanned++;
      const view = viewOf(record, visible.get(record.organizationId)!.name, state.t, now);
      const matchesText = matchesDeviceSearch(view, query.search);
      if ((!query.status || view.status === query.status) && matchesText) {
        const rdKey = normalizeRustDeskIdKey(view.rustdeskId);
        const existingIdx = rdKey ? indexByRustdeskKey.get(rdKey) : undefined;
        if (existingIdx !== undefined) {
          devices[existingIdx] = mergeDuplicateDeviceViews(devices[existingIdx]!, view);
          continue;
        }
        if (rdKey) {
          indexByRustdeskKey.set(rdKey, devices.length);
        }
        devices.push(view);
      }
      if (devices.length === query.limit) {
        if (index + 1 < page.records.length || page.hasMore) {
          return { devices, nextCursor: encodeCursor(state, cursorSecret) };
        }
        state.b++;
        state.k = null;
        while (state.b < batches.length && queries < maxQueriesPerRequest &&
            scanned < maxScannedPerRequest) {
          const probe = await repository.scan(batches[state.b]!, null, state.t, 1);
          queries++;
          scanned++;
          if (probe.records.length) return { devices, nextCursor: encodeCursor(state, cursorSecret) };
          if (probe.hasMore) throw new Error('Invalid device scan page');
          state.b++;
        }
        return { devices, nextCursor: state.b < batches.length
          ? encodeCursor(state, cursorSecret) : null };
      }
    }
    if (!page.hasMore) {
      state.b++;
      state.k = null;
    }
  }
  return { devices, nextCursor: state.b < batches.length ? encodeCursor(state, cursorSecret) : null };
}
