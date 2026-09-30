import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { DeviceViewSchema, type DeviceListQuery, type DeviceView } from '@appremoto/contracts';

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
  return DeviceViewSchema.parse({
    id: record.id, organizationId: record.organizationId, organizationName,
    deviceUuid: record.deviceUuid, displayName: record.displayName, hostname: record.hostname,
    operatingSystem: record.operatingSystem, osVersion: record.osVersion,
    rustdeskId: record.rustdeskId, agentVersion: record.agentVersion,
    rustdeskVersion: record.rustdeskVersion,
    lastSeenAt: Number.isFinite(seen) ? new Date(seen).toISOString() : null,
    enabled: record.enabled,
    status: online ? 'ONLINE' : 'OFFLINE',
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
  const search = query.search?.toLocaleLowerCase();
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
      if ((!query.status || view.status === query.status) &&
          (!search || [view.displayName, view.hostname, view.rustdeskId]
            .some((value) => value.toLocaleLowerCase().includes(search)))) devices.push(view);
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
