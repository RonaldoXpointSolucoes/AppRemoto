import { createHash } from 'node:crypto';
import { DeviceViewSchema, type DeviceListQuery, type DeviceView } from '@appremoto/contracts';

import type { AuthenticatedTechnician } from '../plugins/technician-auth.ts';
import type { DeviceRecord, DeviceRepository } from '../repositories/devices.ts';

export interface DevicePage {
  devices: DeviceView[];
  nextCursor: string | null;
}

export class InvalidDeviceCursorError extends Error {}

function statusOf(device: DeviceRecord, now: Date): 'ONLINE' | 'OFFLINE' {
  if (!device.enabled || !device.lastSeenAt) return 'OFFLINE';
  const seen = validSeenAt(device.lastSeenAt);
  return Number.isFinite(seen) && now.getTime() - seen <= 90_000 ? 'ONLINE' : 'OFFLINE';
}

function validSeenAt(value: string | null): number {
  if (!value || !DeviceViewSchema.shape.lastSeenAt.safeParse(value).success) return NaN;
  return Date.parse(value);
}

function cursorSignature(organizationIds: string[], query: DeviceListQuery, position: number): string {
  return createHash('sha256').update(JSON.stringify({ organizationIds, organizationId: query.organizationId,
    status: query.status, search: query.search?.toLocaleLowerCase(), limit: query.limit, position }))
    .digest('hex').slice(0, 12);
}

function decodeCursor(cursor: string | undefined, organizationIds: string[], query: DeviceListQuery): number {
  if (!cursor) return 0;
  let decoded: string;
  try { decoded = Buffer.from(cursor, 'base64url').toString('utf8'); }
  catch { throw new InvalidDeviceCursorError(); }
  const match = /^(0|[1-9][0-9]*):([a-f0-9]{12})$/.exec(decoded);
  if (!match) throw new InvalidDeviceCursorError();
  const position = Number(match[1]);
  if (!Number.isSafeInteger(position) || position < 1 ||
      cursorSignature(organizationIds, query, position) !== match[2] ||
      Buffer.from(decoded).toString('base64url') !== cursor) throw new InvalidDeviceCursorError();
  return position;
}

export async function listDevices(technician: AuthenticatedTechnician, query: DeviceListQuery,
  repository: DeviceRepository, now: Date): Promise<DevicePage> {
  const visible = new Map(technician.organizations
    .filter((organization) => technician.authorization.some((permission) =>
      permission.organizationId === organization.id && permission.canView))
    .map((organization) => [organization.id, organization]));
  const organizationIds = [...visible.keys()].sort();
  if (query.organizationId && !visible.has(query.organizationId)) return { devices: [], nextCursor: null };
  const position = decodeCursor(query.cursor, organizationIds, query);

  const selectedIds = query.organizationId ? [query.organizationId] : organizationIds;
  const records = (await Promise.all(selectedIds.map((id) => repository.listByOrganization(id)))).flat();
  const search = query.search?.toLocaleLowerCase();
  const devices: DeviceView[] = records.map((record) => {
    const seen = validSeenAt(record.lastSeenAt);
    return {
      id: record.id, organizationId: record.organizationId,
      organizationName: visible.get(record.organizationId)!.name,
      deviceUuid: record.deviceUuid, displayName: record.displayName, hostname: record.hostname,
      operatingSystem: record.operatingSystem, osVersion: record.osVersion,
      rustdeskId: record.rustdeskId, agentVersion: record.agentVersion,
      rustdeskVersion: record.rustdeskVersion,
      lastSeenAt: Number.isFinite(seen) ? new Date(seen).toISOString() : null,
      enabled: record.enabled, status: statusOf(record, now),
    };
  }).filter((view) => (!query.status || view.status === query.status) &&
    (!search || [view.displayName, view.hostname, view.rustdeskId]
      .some((value) => value.toLocaleLowerCase().includes(search))))
    .sort((left, right) => left.organizationId.localeCompare(right.organizationId) ||
      left.id.localeCompare(right.id));
  if (position > devices.length) throw new InvalidDeviceCursorError();
  const page = devices.slice(position, position + query.limit);
  const nextPosition = position + page.length;
  const nextCursor = nextPosition < devices.length
    ? Buffer.from(`${nextPosition}:${cursorSignature(organizationIds, query, nextPosition)}`).toString('base64url')
    : null;
  return { devices: page, nextCursor };
}
