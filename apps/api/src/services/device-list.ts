import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { DeviceViewSchema, extractDataDivasFromNotes, extractDeviceAccessPolicy, type DeviceListQuery, type DeviceView } from '@appremoto/contracts';

import type { AuthenticatedTechnician } from '../plugins/technician-auth.ts';
import type { DeviceRecord, DeviceRepository } from '../repositories/devices.ts';

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
      if ((!query.status || view.status === query.status) && matchesText) devices.push(view);
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
