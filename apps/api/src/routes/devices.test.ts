import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Databases } from 'node-appwrite';

import { buildApp } from '../app.ts';
import { createDeviceRepository, type DeviceRecord, type DeviceRepository } from '../repositories/devices.ts';
import type { TechnicianServices } from '../plugins/technician-auth.ts';

const now = new Date('2026-09-30T12:00:00.000Z');
const auth = { authorization: 'Bearer valid.jwt.value' };
const orgs = [
  { id: 'a', name: 'Alpha', slug: 'alpha', active: true },
  { id: 'b', name: 'Beta', slug: 'beta', active: true },
];

function device(id: string, organizationId: string, changes: Partial<DeviceRecord> = {}): DeviceRecord {
  return { id, organizationId, deviceUuid: '00000000-0000-4000-8000-000000000001',
    displayName: `Device ${id}`, hostname: `host-${id}`, operatingSystem: 'Windows', osVersion: '11',
    rustdeskId: `rd-${id}`, agentVersion: null, rustdeskVersion: null,
    lastSeenAt: '2026-09-30T11:59:00.000Z', enabled: true, ...changes };
}

function services(records: DeviceRecord[], calls: string[]): TechnicianServices {
  return {
    projectId: 'test-project',
    jwtVerifier: { verify: async () => ({ userId: 'tech' }) },
    technicians: {
      findByUserId: async () => ({ userId: 'tech', displayName: 'Tech', active: true }),
      listMemberships: async () => [{ organizationId: 'a', userId: 'tech', role: 'operator',
        canView: true, canConnect: false, canManageDevices: false }],
    },
    organizations: { listActive: async () => orgs },
    devices: { listByOrganization: async (id) => { calls.push(id); return records.filter((record) => record.organizationId === id); } },
    now: () => now,
  };
}

async function get(path: string, dependencies: TechnicianServices) {
  const app = buildApp({ logger: false }, dependencies);
  try { return await app.inject({ method: 'GET', url: path, headers: auth }); }
  finally { await app.close(); }
}

test('lists only authorized organizations and returns safe device views', async () => {
  const calls: string[] = [];
  const response = await get('/v1/devices', services([device('1', 'a'), device('2', 'b')], calls));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, ['a']);
  assert.deepEqual(response.json(), { devices: [{
    id: '1', organizationId: 'a', organizationName: 'Alpha',
    deviceUuid: '00000000-0000-4000-8000-000000000001', displayName: 'Device 1',
    hostname: 'host-1', operatingSystem: 'Windows', osVersion: '11', rustdeskId: 'rd-1',
    agentVersion: null, rustdeskVersion: null, lastSeenAt: '2026-09-30T11:59:00.000Z',
    enabled: true, status: 'ONLINE',
  }], nextCursor: null });
});

test('unauthorized organization filter returns generic empty data without device query', async () => {
  const calls: string[] = [];
  const response = await get('/v1/devices?organizationId=b', services([device('2', 'b')], calls));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { devices: [], nextCursor: null });
  assert.deepEqual(calls, []);
});

test('90-second equality is online, stale, missing, invalid and disabled are offline', async () => {
  const calls: string[] = [];
  const records = [device('1', 'a', { lastSeenAt: '2026-09-30T11:58:30.000Z' }),
    device('2', 'a', { lastSeenAt: '2026-09-30T11:58:29.999Z' }),
    device('3', 'a', { lastSeenAt: null }),
    device('4', 'a', { lastSeenAt: '2026-09-30' }),
    device('5', 'a', { enabled: false })];
  const response = await get('/v1/devices', services(records, calls));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().devices.map((row: { status: string }) => row.status),
    ['ONLINE', 'OFFLINE', 'OFFLINE', 'OFFLINE', 'OFFLINE']);
  assert.equal(response.json().devices[3].lastSeenAt, null);
  const offline = await get('/v1/devices?status=OFFLINE', services(records, []));
  assert.deepEqual(offline.json().devices.map((row: { id: string }) => row.id), ['2', '3', '4', '5']);
});

test('search is case-insensitive substring across name, hostname and RustDesk ID', async () => {
  const records = [device('1', 'a', { displayName: 'Finance PC' }),
    device('2', 'a', { hostname: 'FINANCE-LAPTOP' }),
    device('3', 'a', { rustdeskId: 'xx-FiNaNcE-xx' }), device('4', 'a')];
  const response = await get('/v1/devices?search=finance', services(records, []));
  assert.deepEqual(response.json().devices.map((row: { id: string }) => row.id), ['1', '2', '3']);
});

test('pagination has stable order, no gaps, and a cursor only while more results remain', async () => {
  const records = ['5', '1', '3', '2', '4'].map((id) => device(id, 'a'));
  const dependencies = services(records, []);
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 3; page++) {
    const response = await get(`/v1/devices?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, dependencies);
    assert.equal(response.statusCode, 200);
    const body = response.json();
    ids.push(...body.devices.map((row: { id: string }) => row.id));
    cursor = body.nextCursor;
    if (page < 2) assert.ok(cursor);
    else assert.equal(cursor, null);
  }
  assert.deepEqual(ids, ['1', '2', '3', '4', '5']);
});

test('unknown, repeated, malformed and mismatched query values have one stable error', async () => {
  const dependencies = services([device('1', 'a'), device('2', 'a')], []);
  for (const query of ['unknown=x', 'status=ONLINE&status=OFFLINE', 'limit=0', 'cursor=not-valid',
    'organizationId=a&organizationId=b']) {
    const response = await get(`/v1/devices?${query}`, dependencies);
    assert.equal(response.statusCode, 400, query);
    assert.deepEqual(response.json(), { error: { code: 'INVALID_DEVICE_QUERY', message: 'Invalid device query' } });
  }
  const first = await get('/v1/devices?limit=1', dependencies);
  const cursor = first.json().nextCursor;
  assert.ok(cursor);
  const mismatch = await get(`/v1/devices?limit=1&search=x&cursor=${encodeURIComponent(cursor)}`, dependencies);
  assert.equal(mismatch.statusCode, 400);
  assert.equal(mismatch.json().error.code, 'INVALID_DEVICE_QUERY');
});

test('unauthorized organization remains generically empty even with an unrelated cursor', async () => {
  const calls: string[] = [];
  const response = await get('/v1/devices?organizationId=b&cursor=not-valid',
    services([device('2', 'b')], calls));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { devices: [], nextCursor: null });
  assert.deepEqual(calls, []);
});

test('Appwrite repository reads every ordered page with minimal safe projection', async () => {
  const calls: { collection: string; queries: { method: string; attribute?: string; values?: unknown[] }[] }[] = [];
  const databases = { async listDocuments(_database: string, collection: string, encoded: string[]) {
    const queries = encoded.map((query) => JSON.parse(query));
    calls.push({ collection, queries });
    const offset = queries.find((query) => query.method === 'offset')?.values?.[0] as number;
    const rows = Array.from({ length: 101 }, (_, index) => ({ $id: `${index}`, organization_id: 'a',
      device_uuid: '00000000-0000-4000-8000-000000000001', display_name: `Device ${index}`,
      hostname: `host-${index}`, operating_system: 'Windows', os_version: '11',
      rustdesk_id: `${index}`, agent_version: null, rustdesk_version: null,
      last_seen_at: null, enabled: true, last_ip: 'private' }));
    return { total: rows.length, documents: rows.slice(offset, offset + 100) };
  } } as unknown as Databases;
  const result = await createDeviceRepository(databases).listByOrganization('a');
  assert.equal(result.length, 101);
  assert.deepEqual(calls.map((call) => call.collection), ['devices', 'devices']);
  for (const call of calls) {
    assert.deepEqual(call.queries.find((query) => query.method === 'equal'),
      { method: 'equal', attribute: 'organization_id', values: ['a'] });
    const selected = call.queries.find((query) => query.method === 'select')?.values as string[];
    assert.ok(selected.includes('$id'));
    assert.ok(!selected.includes('last_ip'));
    assert.ok(!selected.some((field) => /token|credential|password/i.test(field)));
  }
  assert.ok(!('last_ip' in result[0]!));
});
