import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../app.ts';
import type { TechnicianServices } from '../plugins/technician-auth.ts';
import Fastify from 'fastify';
import { registerAgentHeartbeatRoute } from './agent-heartbeat.ts';
import { hashToken } from '../security/tokens.ts';
import { createHeartbeatService, HeartbeatError } from '../services/record-heartbeat.ts';
import { IndeterminateEnrollmentWrite, RejectedEnrollmentWrite,
  sameEnrollmentState, type EnrollmentData, type EnrollmentKind } from '../repositories/enrollment.ts';
import type { HeartbeatAudit } from '../repositories/audit.ts';
import { createAuditRepository } from '../repositories/audit.ts';
import { createEnrollmentRepository } from '../repositories/enrollment.ts';
import type { Databases } from 'node-appwrite';
import { HeartbeatResponseSchema } from '@appremoto/contracts';

const token = 'A'.repeat(43);
const payload = { agentVersion: '2', rustdeskVersion: '3', rustdeskId: '456', operatingSystem: 'Windows', osVersion: '12' };
const observed = { deviceId: 'device-1', lastSeenAt: '2026-09-30T12:00:00.000Z' };

test('heartbeat route accepts a device bearer independently of technician JWT authentication', async () => {
  const app = buildApp({ logger: false }, { recordHeartbeat: async () => ({ deviceId: 'device-1',
    lastSeenAt: '2026-09-30T12:00:00.000Z' }) } as unknown as TechnicianServices);
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/agent/heartbeat',
      headers: { authorization: `Bearer ${'A'.repeat(43)}` },
      payload: { agentVersion: '1', rustdeskVersion: '1', rustdeskId: '123', operatingSystem: 'Windows', osVersion: '11' } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { deviceId: 'device-1', lastSeenAt: '2026-09-30T12:00:00.000Z' });
  } finally { await app.close(); }
});

test('heartbeat response schema is minimal and rejects extra or malformed fields', () => {
  assert.deepEqual(HeartbeatResponseSchema.parse(observed), observed);
  for (const invalid of [{ ...observed, tokenHash: 'private' }, { ...observed, lastSeenAt: 'client-time' },
    { ...observed, deviceId: '' }]) assert.equal(HeartbeatResponseSchema.safeParse(invalid).success, false);
});

test('heartbeat rejects duplicate, malformed, noncanonical and oversized bearer values without calling storage', async () => {
  let calls = 0; const app = Fastify();
  registerAgentHeartbeatRoute(app, async () => { calls++; return observed; });
  try {
    const invalid = [undefined, '', `Basic ${token}`, `Bearer ${token} `, `Bearer ${token}.${token}`,
      `Bearer ${'x'.repeat(600)}`, `Bearer ${'_' .repeat(43)}`, `Bearer ${token}, Bearer ${token}`];
    for (const authorization of invalid) {
      const response = await app.inject({ method: 'POST', url: '/v1/agent/heartbeat', payload,
        headers: authorization === undefined ? {} : { authorization } });
      assert.equal(response.statusCode, 401);
      assert.deepEqual(response.json(), { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    }
    const duplicate = await app.inject({ method: 'POST', url: '/v1/agent/heartbeat', payload,
      headers: { authorization: [`Bearer ${token}`, `Bearer ${token}`] } as any });
    assert.equal(duplicate.statusCode, 401);
    assert.equal(calls, 0);
  } finally { await app.close(); }
});

test('heartbeat rejects unknown, missing, array and oversized metadata and query values', async () => {
  let calls = 0; const app = Fastify();
  registerAgentHeartbeatRoute(app, async () => { calls++; return observed; });
  try {
    const invalid = [{ ...payload, extra: 'no' }, { ...payload, agentVersion: undefined },
      { ...payload, rustdeskId: ['456'] }, { ...payload, osVersion: 'x'.repeat(129) },
      { ...payload, rustdeskVersion: '' }];
    for (const body of invalid) {
      const response = await app.inject({ method: 'POST', url: '/v1/agent/heartbeat', payload: body,
        headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.statusCode, 400);
    }
    const query = await app.inject({ method: 'POST', url: '/v1/agent/heartbeat?token=secret', payload,
      headers: { authorization: `Bearer ${token}` } });
    assert.equal(query.statusCode, 400); assert.equal(calls, 0);
  } finally { await app.close(); }
});

test('heartbeat route uses canonical request IP and masks bearer, body and query secrets in logs', async () => {
  for (const trustProxy of [false, ['127.0.0.1']]) {
    const logs: string[] = []; const ips: string[] = [];
    const app = Fastify({ trustProxy, logger: { stream: { write: (line: string) => logs.push(line) } } });
    registerAgentHeartbeatRoute(app, async (_hash, _body, ip) => { ips.push(ip); return observed; });
    try {
      const response = await app.inject({ method: 'POST', url: '/v1/agent/heartbeat', payload,
        remoteAddress: '127.0.0.1', headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '192.0.2.1' } });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(ips, [trustProxy ? '192.0.2.1' : '127.0.0.1']);
      assert.equal(response.headers['cache-control'], 'no-store');
      await app.inject({ method: 'POST', url: '/v1/agent/heartbeat?token=QUERY_SECRET',
        headers: { authorization: `Bearer ${token}` }, payload: { ...payload, password: 'BODY_SECRET' } });
      assert.ok(!logs.join('').includes(token));
      assert.ok(!logs.join('').includes('QUERY_SECRET'));
      assert.ok(!logs.join('').includes('BODY_SECRET'));
    } finally { await app.close(); }
  }
});

test('heartbeat route exposes no identity or storage detail on authentication and storage failures', async () => {
  for (const failure of [new HeartbeatError('UNAUTHENTICATED'),
    new HeartbeatError('HEARTBEAT_UNAVAILABLE', true), new Error('private storage detail')]) {
    const logs: string[] = [];
    const app = Fastify({ logger: { stream: { write: (line: string) => logs.push(line) } } });
    registerAgentHeartbeatRoute(app, async () => { throw failure; });
    try {
      const response = await app.inject({ method: 'POST', url: '/v1/agent/heartbeat', payload,
        headers: { authorization: `Bearer ${token}` } });
      assert.deepEqual(response.json(), failure instanceof HeartbeatError && failure.code === 'UNAUTHENTICATED' ?
        { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } } :
        { error: { code: 'HEARTBEAT_UNAVAILABLE', message: 'Heartbeat unavailable' } });
      assert.ok(!response.body.includes('private storage detail'));
      assert.ok(!logs.join('').includes(token));
      assert.ok(!logs.join('').includes('private storage detail'));
    } finally { await app.close(); }
  }
});

function fixture() {
  const rows = new Map<string, EnrollmentData>([
    ['device_tokens/device-1', { device_id: 'device-1', token_hash: hashToken(token), last_used_at: null, revoked_at: null }],
    ['devices/device-1', { organization_id: 'org-1', device_uuid: '00000000-0000-4000-8000-000000000001',
      display_name: 'Workstation', hostname: 'host', operating_system: 'Windows', os_version: '11',
      rustdesk_id: '123', agent_version: '1', rustdesk_version: '1', last_seen_at: null,
      last_ip: '192.0.2.9', enabled: true }],
  ]);
  const events: Array<{ id: string; event: HeartbeatAudit }> = [];
  let fail = new Set<string>();
  let gate: Promise<void> | null = null;
  const repository = {
    async findDeviceToken(hash: string) {
      const match = [...rows].filter(([key, row]) => key.startsWith('device_tokens/') && row.token_hash === hash);
      if (match.length > 1) throw new Error('ambiguous');
      return match[0] ? { id: match[0][0].slice('device_tokens/'.length), ...structuredClone(match[0][1]) } : null;
    },
    async snapshot(kind: EnrollmentKind, id: string) { return structuredClone(rows.get(`${kind}/${id}`) ?? null); },
    async write(kind: EnrollmentKind, id: string, data: EnrollmentData) {
      if (kind === 'devices' && gate) await gate;
      if (fail.has(`write:${kind}`)) throw new RejectedEnrollmentWrite();
      rows.set(`${kind}/${id}`, structuredClone(data));
      if (fail.has(`indeterminate:${kind}`)) throw new IndeterminateEnrollmentWrite();
    },
    async restore(kind: EnrollmentKind, id: string, before: EnrollmentData | null, expected: EnrollmentData) {
      if (fail.has(`restore:${kind}`)) throw new Error('restore failed');
      const current = rows.get(`${kind}/${id}`);
      if (sameEnrollmentState(kind, current ?? null, before)) return;
      if (!sameEnrollmentState(kind, current ?? null, expected)) throw new Error('changed');
      if (before) rows.set(`${kind}/${id}`, structuredClone(before)); else rows.delete(`${kind}/${id}`);
    },
  };
  const audit = {
    async recordHeartbeat(id: string, event: HeartbeatAudit) {
      if (fail.has('audit')) throw new Error('audit failed');
      events.push({ id, event: structuredClone(event) });
    },
    async remove(id: string) { if (fail.has('remove')) throw new Error('remove failed');
      const index = events.findIndex((entry) => entry.id === id); if (index >= 0) events.splice(index, 1); },
  };
  const service = createHeartbeatService({ repository, audit, now: () => new Date('2026-09-30T12:00:00.000Z') });
  return { rows, events, service, setFail: (...points: string[]) => { fail = new Set(points); },
    setGate: (value: Promise<void> | null) => { gate = value; } };
}

test('valid heartbeat updates only permitted metadata, uses one server timestamp and writes fixed audit metadata', async () => {
  const f = fixture(); const before = structuredClone(f.rows.get('devices/device-1'));
  const response = await f.service(hashToken(token), payload, '192.0.2.1');
  assert.deepEqual(response, observed);
  assert.deepEqual(f.rows.get('devices/device-1'), { ...before, operating_system: 'Windows', os_version: '12',
    agent_version: '2', rustdesk_id: '456', rustdesk_version: '3',
    last_seen_at: '2026-09-30T12:00:00.000Z', last_ip: '192.0.2.1' });
  assert.equal(f.rows.get('device_tokens/device-1')?.last_used_at, '2026-09-30T12:00:00.000Z');
  assert.deepEqual(f.events.map(({ event }) => event), [{ organizationId: 'org-1', deviceId: 'device-1',
    sourceIp: '192.0.2.1', result: 'success', recoveryRequired: false }]);
});

test('wrong, revoked, disabled and mismatched device tokens fail generically without writes', async () => {
  for (const defect of ['missing', 'revoked', 'disabled', 'mismatch', 'device_missing']) {
    const f = fixture();
    if (defect === 'revoked') f.rows.get('device_tokens/device-1')!.revoked_at = '2026-09-29T12:00:00Z';
    if (defect === 'disabled') f.rows.get('devices/device-1')!.enabled = false;
    if (defect === 'mismatch') f.rows.get('device_tokens/device-1')!.device_id = 'other';
    if (defect === 'device_missing') f.rows.delete('devices/device-1');
    const before = structuredClone([...f.rows]);
    await assert.rejects(f.service(defect === 'missing' ? 'f'.repeat(64) : hashToken(token), payload, '192.0.2.1'),
      (error: unknown) => error instanceof HeartbeatError && error.code === 'UNAUTHENTICATED');
    assert.deepEqual([...f.rows], before); assert.deepEqual(f.events, []);
  }
});

test('partial device, token and audit failures restore previous state and report unavailable', async () => {
  for (const point of ['write:devices', 'write:device_tokens', 'audit']) {
    const f = fixture(); const before = structuredClone([...f.rows]); f.setFail(point);
    await assert.rejects(f.service(hashToken(token), payload, '192.0.2.1'),
      (error: unknown) => error instanceof HeartbeatError && error.code === 'HEARTBEAT_UNAVAILABLE' && !error.recoveryRequired);
    assert.deepEqual([...f.rows], before);
  }
});

test('indeterminate write or failed restore reports recoveryRequired and blocks another heartbeat', async () => {
  for (const point of ['indeterminate:devices', 'restore:devices']) {
    const f = fixture(); f.setFail(...(point === 'restore:devices' ? ['write:device_tokens', 'restore:devices'] : [point]));
    await assert.rejects(f.service(hashToken(token), payload, '192.0.2.1'),
      (error: unknown) => error instanceof HeartbeatError && error.code === 'HEARTBEAT_UNAVAILABLE' && error.recoveryRequired);
    f.setFail();
    await assert.rejects(f.service(hashToken(token), payload, '192.0.2.1'),
      (error: unknown) => error instanceof HeartbeatError && error.code === 'HEARTBEAT_UNAVAILABLE' && error.recoveryRequired);
    assert.ok(f.events.some(({ event }) => event.result === 'failure' && event.recoveryRequired));
  }
});

test('concurrent heartbeats for the same device serialize their snapshots and preserve the later metadata', async () => {
  const f = fixture(); let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; }); f.setGate(gate);
  const first = f.service(hashToken(token), payload, '192.0.2.1');
  const second = f.service(hashToken(token), { ...payload, agentVersion: '4' }, '192.0.2.2');
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([first, second]);
  assert.equal(f.rows.get('devices/device-1')?.agent_version, '4');
  assert.equal(f.rows.get('devices/device-1')?.last_ip, '192.0.2.2');
  assert.equal(f.events.filter(({ event }) => event.result === 'success').length, 2);
});

test('Appwrite token hash lookup has a unique projection and normalizes absent revocation to null', async () => {
  let queries: string[] = [];
  const repository = createEnrollmentRepository({
    async listDocuments(_database: string, _collection: string, requested: string[]) {
      queries = requested; return { total: 1, documents: [{ $id: 'device-1', device_id: 'device-1',
        token_hash: hashToken(token), last_used_at: '2026-09-30T12:00:00+00:00' }] };
    },
  } as unknown as Databases);
  const found = await repository.findDeviceToken(hashToken(token));
  assert.equal(found?.revoked_at, null);
  assert.equal(found?.last_used_at, '2026-09-30T12:00:00.000Z');
  const decoded = queries.map((query) => JSON.parse(query));
  assert.ok(decoded.some((query) => query.method === 'equal' && query.attribute === 'token_hash' &&
    query.values[0] === hashToken(token)));
  assert.ok(decoded.some((query) => query.method === 'limit' && query.values[0] === 2));
});

test('Appwrite duplicate device-token hash never resolves to an arbitrary device', async () => {
  const repository = createEnrollmentRepository({
    async listDocuments() { return { total: 2, documents: [
      { $id: 'device-1', device_id: 'device-1', token_hash: hashToken(token) },
      { $id: 'device-2', device_id: 'device-2', token_hash: hashToken(token) },
    ] }; },
  } as unknown as Databases);
  await assert.rejects(repository.findDeviceToken(hashToken(token)), /^Error: Enrollment storage unavailable$/);
});

test('heartbeat state comparison treats equivalent Appwrite datetime offsets as equal', () => {
  const canonical = { device_id: 'device-1', token_hash: hashToken(token),
    last_used_at: '2026-09-30T12:00:00.000Z', revoked_at: null };
  const offset = { ...canonical, last_used_at: '2026-09-30T09:00:00-03:00' };
  assert.equal(sameEnrollmentState('device_tokens', canonical, offset), true);
});

test('Appwrite heartbeat audit stores only fixed nonsecret fields', async () => {
  let persisted: Record<string, unknown> = {};
  const audit = createAuditRepository({
    async createDocument(_database: string, _collection: string, _id: string, data: Record<string, unknown>) {
      persisted = data;
    },
  } as unknown as Databases);
  await audit.recordHeartbeat('audit-1', { organizationId: 'org-1', deviceId: 'device-1',
    sourceIp: '192.0.2.1', result: 'success', recoveryRequired: false });
  assert.equal(persisted.actor_type, 'device'); assert.equal(persisted.actor_id, 'device-1');
  assert.equal(persisted.action, 'device.heartbeat');
  assert.deepEqual(JSON.parse(persisted.metadata_json as string), { recoveryRequired: false });
  assert.ok(!JSON.stringify(persisted).includes(token));
});
