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
    createdAt: '2026-09-29T12:00:00.000Z',
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
    devices: { scan: async (ids, afterId, snapshotTime, limit) => {
      calls.push(ids.join(','));
      const matching = records.filter((record) => ids.includes(record.organizationId) &&
        record.createdAt <= snapshotTime && (!afterId || record.id > afterId))
        .sort((left, right) => left.id.localeCompare(right.id));
      return { records: matching.slice(0, limit), hasMore: matching.length > limit };
    } },
    cursorSecret: Buffer.alloc(32, 7),
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
    device('5', 'a', { enabled: false }),
    device('6', 'a', { lastSeenAt: '2026-09-30T12:00:00.001Z' })];
  const response = await get('/v1/devices', services(records, calls));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().devices.map((row: { status: string }) => row.status),
    ['ONLINE', 'OFFLINE', 'OFFLINE', 'OFFLINE', 'OFFLINE', 'OFFLINE']);
  assert.equal(response.json().devices[3].lastSeenAt, null);
  const offline = await get('/v1/devices?status=OFFLINE', services(records, []));
  assert.deepEqual(offline.json().devices.map((row: { id: string }) => row.id), ['2', '3', '4', '5', '6']);
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

test('Appwrite repository scans one bounded keyset page with snapshot and safe projection', async () => {
  const calls: { collection: string; queries: { method: string; attribute?: string; values?: unknown[] }[] }[] = [];
  const databases = { async listDocuments(_database: string, collection: string, encoded: string[]) {
    const queries = encoded.map((query) => JSON.parse(query));
    calls.push({ collection, queries });
    const rows = Array.from({ length: 101 }, (_, index) => ({ $id: `z${String(index).padStart(3, '0')}`, $createdAt: '2026-09-29T12:00:00.000Z', organization_id: 'a',
      device_uuid: '00000000-0000-4000-8000-000000000001', display_name: `Device ${index}`,
      hostname: `host-${index}`, operating_system: 'Windows', os_version: '11',
      rustdesk_id: `${index}`, agent_version: null, rustdesk_version: null,
      last_seen_at: null, enabled: true, last_ip: 'private' }));
    return { total: rows.length, documents: rows.slice(0, 21) };
  } } as unknown as Databases;
  const result = await createDeviceRepository(databases).scan(['a'], 'previous-id', '2026-09-30T12:00:00.000Z', 20);
  assert.equal(result.records.length, 20);
  assert.equal(result.hasMore, true);
  assert.deepEqual(calls.map((call) => call.collection), ['devices']);
  for (const call of calls) {
    assert.deepEqual(call.queries.find((query) => query.method === 'equal'),
      { method: 'equal', attribute: 'organization_id', values: ['a'] });
    const selected = call.queries.find((query) => query.method === 'select')?.values as string[];
    assert.ok(selected.includes('$id'));
    assert.ok(selected.includes('$createdAt'));
    assert.ok(!selected.includes('last_ip'));
    assert.ok(!selected.some((field) => /token|credential|password/i.test(field)));
  }
  assert.ok(!('last_ip' in result.records[0]!));
  const queries = calls[0]!.queries;
  assert.deepEqual(queries.find((query) => query.method === 'greaterThan'),
    { method: 'greaterThan', attribute: '$id', values: ['previous-id'] });
  assert.deepEqual(queries.find((query) => query.method === 'lessThanEqual'),
    { method: 'lessThanEqual', attribute: '$createdAt', values: ['2026-09-30T12:00:00.000Z'] });
  assert.deepEqual(queries.find((query) => query.method === 'limit')?.values, [21]);
  assert.equal(queries.some((query) => query.method === 'offset'), false);
});

test('insertion after page one is excluded and deleting an earlier row does not skip later IDs', async () => {
  const records = ['a', 'b', 'c', 'd'].map((id) => device(id, 'a'));
  const dependencies = services(records, []);
  const first = await get('/v1/devices?limit=2', dependencies);
  assert.deepEqual(first.json().devices.map((row: { id: string }) => row.id), ['a', 'b']);
  records.push(device('bb', 'a', { createdAt: '2026-09-30T12:00:00.001Z' }));
  records.splice(0, 1);
  const second = await get(`/v1/devices?limit=2&cursor=${encodeURIComponent(first.json().nextCursor)}`, dependencies);
  assert.deepEqual(second.json().devices.map((row: { id: string }) => row.id), ['c', 'd']);
  assert.equal(second.json().nextCursor, null);
});

test('online status uses page-one snapshot even when wall clock ages between pages', async () => {
  const records = [device('a', 'a', { lastSeenAt: '2026-09-30T11:59:00.000Z' }),
    device('b', 'a', { lastSeenAt: '2026-09-30T11:58:31.000Z' })];
  const dependencies = services(records, []);
  let clock = now;
  dependencies.now = () => clock;
  const first = await get('/v1/devices?limit=1&status=ONLINE', dependencies);
  assert.deepEqual(first.json().devices.map((row: { id: string }) => row.id), ['a']);
  clock = new Date('2026-09-30T12:05:00.000Z');
  const second = await get(`/v1/devices?limit=1&status=ONLINE&cursor=${encodeURIComponent(first.json().nextCursor)}`, dependencies);
  assert.deepEqual(second.json().devices.map((row: { id: string }) => row.id), ['b']);
});

test('legitimate heartbeat after page one keeps the next device online', async () => {
  const records = [device('a', 'a', { lastSeenAt: '2026-09-30T11:59:30.000Z' }),
    device('b', 'a', { lastSeenAt: '2026-09-30T11:59:30.000Z' })];
  const dependencies = services(records, []);
  let clock = now;
  dependencies.now = () => clock;
  const first = await get('/v1/devices?limit=1&status=ONLINE', dependencies);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.json().devices.map((row: { id: string }) => row.id), ['a']);
  records[1]!.lastSeenAt = '2026-09-30T12:00:05.000Z';
  clock = new Date('2026-09-30T12:00:10.000Z');
  const second = await get(`/v1/devices?limit=1&status=ONLINE&cursor=${encodeURIComponent(first.json().nextCursor)}`, dependencies);
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.json().devices.map((row: { id: string; status: string }) => [row.id, row.status]),
    [['b', 'ONLINE']]);
  assert.equal(second.json().nextCursor, null);
});

test('post-snapshot heartbeat is offline when an old cursor resumes more than 90 seconds later', async () => {
  const records = [device('a', 'a', { lastSeenAt: '2026-09-30T11:59:30.000Z' }),
    device('b', 'a', { lastSeenAt: '2026-09-30T11:59:30.000Z' })];
  const dependencies = services(records, []);
  let clock = now;
  dependencies.now = () => clock;
  const first = await get('/v1/devices?limit=1&status=ONLINE', dependencies);
  records[1]!.lastSeenAt = '2026-09-30T12:00:05.000Z';
  clock = new Date('2026-09-30T12:02:00.001Z');
  const second = await get(`/v1/devices?limit=1&status=ONLINE&cursor=${encodeURIComponent(first.json().nextCursor)}`, dependencies);
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.json().devices, []);
  assert.equal(second.json().nextCursor, null);
});

test('heartbeat later than the current request remains offline on a continuation', async () => {
  const records = [device('a', 'a'), device('b', 'a', { lastSeenAt: '2026-09-30T12:00:20.000Z' })];
  const dependencies = services(records, []);
  let clock = now;
  dependencies.now = () => clock;
  const first = await get('/v1/devices?limit=1', dependencies);
  clock = new Date('2026-09-30T12:00:10.000Z');
  const second = await get(`/v1/devices?limit=1&cursor=${encodeURIComponent(first.json().nextCursor)}`, dependencies);
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.json().devices.map((row: { id: string; status: string }) => [row.id, row.status]),
    [['b', 'OFFLINE']]);
});

test('offline-to-online heartbeat between pages advances the raw key without duplicates', async () => {
  const records = [device('a', 'a', { lastSeenAt: null }),
    device('b', 'a', { lastSeenAt: null }), device('c', 'a', { lastSeenAt: null })];
  const dependencies = services(records, []);
  let clock = now;
  dependencies.now = () => clock;
  const first = await get('/v1/devices?limit=1&status=OFFLINE', dependencies);
  assert.deepEqual(first.json().devices.map((row: { id: string }) => row.id), ['a']);
  records[1]!.lastSeenAt = '2026-09-30T12:00:05.000Z';
  clock = new Date('2026-09-30T12:00:10.000Z');
  const second = await get(`/v1/devices?limit=1&status=OFFLINE&cursor=${encodeURIComponent(first.json().nextCursor)}`, dependencies);
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.json().devices.map((row: { id: string }) => row.id), ['c']);
  assert.equal(second.json().nextCursor, null);
});

test('HMAC cursor rejects tampering, version change, and another signing key', async () => {
  const records = [device('a', 'a'), device('b', 'a')];
  const dependencies = services(records, []);
  const first = await get('/v1/devices?limit=1', dependencies);
  const cursor = first.json().nextCursor as string;
  assert.ok(cursor);
  const [payload, mac] = cursor.split('.');
  assert.ok(payload && mac);
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = alphabet.indexOf(mac.at(-1)!);
  const nonCanonicalMac = mac.slice(0, -1) + alphabet[(last & ~3) | ((last + 1) & 3)];
  assert.notEqual(nonCanonicalMac, mac);
  for (const candidate of [
    `${Buffer.from(JSON.stringify({ ...decoded, k: 'zz' })).toString('base64url')}.${mac}`,
    `${Buffer.from(JSON.stringify({ ...decoded, v: 0 })).toString('base64url')}.${mac}`,
    `${payload}.${mac.slice(0, -1)}A`,
    `${payload}.${nonCanonicalMac}`,
  ]) {
    const response = await get(`/v1/devices?limit=1&cursor=${encodeURIComponent(candidate)}`, dependencies);
    assert.equal(response.statusCode, 400);
  }
  const forged = services(records, []);
  forged.cursorSecret = Buffer.alloc(32, 8);
  const response = await get(`/v1/devices?limit=1&cursor=${encodeURIComponent(cursor)}`, forged);
  assert.equal(response.statusCode, 400);
});

test('cursor rejects scope, organization filter, and limit changes', async () => {
  const records = [device('a', 'a'), device('b', 'a')];
  const dependencies = services(records, []);
  const first = await get('/v1/devices?limit=1', dependencies);
  const cursor = encodeURIComponent(first.json().nextCursor);
  for (const query of [`limit=2&cursor=${cursor}`, `limit=1&organizationId=a&cursor=${cursor}`]) {
    const response = await get(`/v1/devices?${query}`, dependencies);
    assert.equal(response.statusCode, 400);
  }
  const changedScope = services(records, []);
  changedScope.technicians = { ...changedScope.technicians, listMemberships: async () => [] };
  const response = await get(`/v1/devices?limit=1&cursor=${cursor}`, changedScope);
  assert.equal(response.statusCode, 400);
});

test('filtered scan has an aggregate work bound and can return an empty page with cursor', async () => {
  const records = Array.from({ length: 601 }, (_, index) => device(String(index).padStart(4, '0'), 'a',
    { displayName: index === 600 ? 'target' : 'other' }));
  const calls: string[] = [];
  const dependencies = services(records, calls);
  const scan = dependencies.devices!.scan;
  dependencies.devices = { scan: async (ids, afterId, snapshotTime, limit) => {
    assert.ok(limit <= 99);
    return scan(ids, afterId, snapshotTime, limit);
  } };
  const first = await get('/v1/devices?limit=1&search=target', dependencies);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.json().devices, []);
  assert.ok(first.json().nextCursor);
  assert.ok(calls.length <= 5);
  const second = await get(`/v1/devices?limit=1&search=target&cursor=${encodeURIComponent(first.json().nextCursor)}`, dependencies);
  assert.deepEqual(second.json().devices.map((row: { id: string }) => row.id), ['0600']);
});

test('malformed stored view is rejected generically without leaking the value', async () => {
  const record = device('a', 'a', { hostname: 'secret-invalid-' + 'x'.repeat(250) });
  const response = await get('/v1/devices', services([record], []));
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: { code: 'DEVICES_UNAVAILABLE', message: 'Devices unavailable' } });
  assert.ok(!response.body.includes('secret-invalid'));
});

test('batching authorized organizations does not emit a cursor for trailing empty batches', async () => {
  const organizations = Array.from({ length: 26 }, (_, index) => ({
    id: `o${String(index).padStart(2, '0')}`, name: `Organization ${index}`, slug: `o${index}`, active: true,
  }));
  const calls: string[] = [];
  const dependencies = services([device('a', 'o00')], calls);
  dependencies.organizations = { listActive: async () => organizations };
  dependencies.technicians = {
    findByUserId: async () => ({ userId: 'tech', displayName: 'Tech', globalRole: 'super_admin', active: true }),
    listMemberships: async () => [],
  };
  const response = await get('/v1/devices?limit=1', dependencies);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().devices.map((row: { id: string }) => row.id), ['a']);
  assert.equal(response.json().nextCursor, null);
  assert.ok(calls.length <= 5);
  assert.ok(calls.every((batch) => batch.split(',').length <= 25));
});
