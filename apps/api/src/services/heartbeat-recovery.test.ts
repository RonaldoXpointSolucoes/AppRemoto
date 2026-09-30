import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppwriteException, type Databases } from 'node-appwrite';
import { createEnrollmentRepository, sameEnrollmentState } from '../repositories/enrollment.ts';
import { createAuditRepository } from '../repositories/audit.ts';
import { createHeartbeatService, HeartbeatError } from './record-heartbeat.ts';
import { hashToken } from '../security/tokens.ts';
import { listDevices } from './device-list.ts';

const deviceId = 'device-1';
const token = 'A'.repeat(43);
const hash = hashToken(token);
const body = { agentVersion: '2', rustdeskVersion: '2', rustdeskId: '456', operatingSystem: 'Windows', osVersion: '12' };
const firstTime = '2026-09-30T12:00:00.000Z';

function storage(omitted = false) {
  const device: Record<string, unknown> = { organization_id: 'org-1',
    device_uuid: '00000000-0000-4000-8000-000000000001', display_name: 'Desk', hostname: 'desk',
    operating_system: 'Windows', os_version: '11', rustdesk_id: '123', enabled: true,
    ...(omitted ? {} : { agent_version: '1', rustdesk_version: '1',
      last_seen_at: null, last_ip: null }),
  };
  const deviceToken: Record<string, unknown> = { device_id: deviceId, token_hash: hash,
    ...(omitted ? {} : { last_used_at: null, revoked_at: null }) };
  const rows = new Map<string, Record<string, unknown>>([
    [`devices/${deviceId}`, device], [`device_tokens/${deviceId}`, deviceToken],
  ]);
  const submitted: Array<{ kind: string; changes: Record<string, unknown> }> = [];
  let delayedDevice: (() => void) | null = null;
  let delayedToken: (() => void) | null = null;
  let delayedAudit: (() => void) | null = null;
  let deferDevice = false; let deferToken = false; let failToken = false; let failVerify = false;
  let failFreeze = false; let ignoreClears = false;
  let auditMode: 'normal' | 'late-before' | 'late-after' | 'late-both' | 'definite' = 'normal';
  let firstAudit = true;
  function apply(kind: string, id: string, changes: Record<string, unknown>) {
    const key = `${kind}/${id}`; const current = rows.get(key);
    if (!current) throw new AppwriteException('missing', 404);
    const next = structuredClone(current);
    for (const [field, value] of Object.entries(changes)) {
      if (ignoreClears && value === null) continue;
      if (omitted && value === null) delete next[field]; else next[field] = value;
    }
    rows.set(key, next); return { $id: id, ...structuredClone(next) };
  }
  const databases = {
    async listDocuments(_database: string, kind: string) {
      if (kind !== 'device_tokens') throw new Error('unexpected list');
      return { total: 1, documents: [{ $id: deviceId, ...structuredClone(rows.get(`device_tokens/${deviceId}`)) }] };
    },
    async getDocument(_database: string, kind: string, id: string) {
      if (failVerify && kind === 'devices' && rows.get(`device_tokens/${deviceId}`)?.last_used_at === firstTime) {
        failVerify = false; throw new Error('verification unavailable');
      }
      if (kind === 'audit_logs' && auditMode === 'late-before' && delayedAudit) {
        delayedAudit(); delayedAudit = null;
      }
      const row = rows.get(`${kind}/${id}`);
      if (!row) throw new AppwriteException('missing', 404);
      return { $id: id, ...structuredClone(row) };
    },
    async updateDocument(_database: string, kind: string, id: string, changes: Record<string, unknown>) {
      submitted.push({ kind, changes: structuredClone(changes) });
      if (kind === 'devices' && deferDevice && 'last_seen_at' in changes) {
        deferDevice = false;
        delayedDevice = () => { apply(kind, id, changes); };
        throw new Error('transport timeout');
      }
      if (kind === 'device_tokens' && failToken && 'last_used_at' in changes) {
        throw new AppwriteException('rejected', 400);
      }
      if (failFreeze && ('enabled' in changes || 'revoked_at' in changes)) {
        throw new Error('freeze unavailable');
      }
      if (kind === 'device_tokens' && deferToken && 'last_used_at' in changes) {
        deferToken = false;
        delayedToken = () => { apply(kind, id, changes); };
        throw new Error('transport timeout');
      }
      return apply(kind, id, changes);
    },
    async createDocument(_database: string, kind: string, id: string, data: Record<string, unknown>) {
      if (kind !== 'audit_logs') throw new Error('unexpected create');
      if (auditMode === 'definite') throw new AppwriteException('rejected', 400);
      if ((firstAudit || auditMode === 'late-both') && auditMode !== 'normal') {
        firstAudit = false;
        delayedAudit = () => {
          if (rows.has(`${kind}/${id}`)) throw new AppwriteException('duplicate', 409);
          rows.set(`${kind}/${id}`, structuredClone(data));
        };
        throw new Error('transport timeout');
      }
      if (rows.has(`${kind}/${id}`)) throw new AppwriteException('duplicate', 409);
      rows.set(`${kind}/${id}`, structuredClone(data)); return { $id: id, ...data };
    },
    async deleteDocument(_database: string, kind: string, id: string) {
      if (!rows.delete(`${kind}/${id}`)) throw new AppwriteException('missing', 404);
    },
  } as unknown as Databases;
  const repository = createEnrollmentRepository(databases);
  const audit = createAuditRepository(databases);
  const service = (timestamp = firstTime) => createHeartbeatService({ repository, audit, now: () => new Date(timestamp) });
  return { rows, submitted, repository, audit, service,
    deferDevice: () => { deferDevice = true; }, deferToken: () => { deferToken = true; },
    failToken: () => { failToken = true; }, failVerify: () => { failVerify = true; },
    failFreeze: () => { failFreeze = true; },
    ignoreClears: () => { ignoreClears = true; },
    auditMode: (mode: typeof auditMode) => { auditMode = mode; },
    releaseDevice: () => { delayedDevice?.(); delayedDevice = null; },
    releaseToken: () => { delayedToken?.(); delayedToken = null; },
    releaseAudit: () => { try { delayedAudit?.(); } catch (error) {
      if (!(error instanceof AppwriteException) || error.code !== 409) throw error;
    } delayedAudit = null; },
  };
}

test('indeterminate metadata PATCH durably disables and revokes before a replacement service can admit another heartbeat', async () => {
  const f = storage(); f.deferDevice();
  await assert.rejects(f.service()(hash, body, '192.0.2.1'),
    (error: unknown) => error instanceof HeartbeatError && error.recoveryRequired);
  assert.equal(f.rows.get(`devices/${deviceId}`)?.enabled, false);
  assert.equal(f.rows.get(`device_tokens/${deviceId}`)?.revoked_at, firstTime);
  assert.deepEqual(f.submitted.filter(({ kind, changes }) => kind === 'devices' && 'enabled' in changes)
    .map(({ changes }) => changes), [{ enabled: false }]);
  assert.deepEqual(f.submitted.filter(({ kind, changes }) => kind === 'device_tokens' && 'revoked_at' in changes)
    .map(({ changes }) => changes), [{ revoked_at: firstTime }]);
  await assert.rejects(f.service('2026-09-30T12:01:00.000Z')(hash, { ...body, agentVersion: '3' }, '192.0.2.2'),
    (error: unknown) => error instanceof HeartbeatError && error.code === 'UNAUTHENTICATED');
  f.releaseDevice();
  assert.equal(f.rows.get(`devices/${deviceId}`)?.enabled, false);
  assert.equal(f.rows.get(`device_tokens/${deviceId}`)?.revoked_at, firstTime);
  assert.equal(f.rows.get(`devices/${deviceId}`)?.last_seen_at, firstTime);
  const row = f.rows.get(`devices/${deviceId}`)!;
  const page = await listDevices({ organizations: [{ id: 'org-1', name: 'Org' }],
    authorization: [{ organizationId: 'org-1', canView: true }] } as any, { limit: 50 },
  { scan: async () => ({ records: [{ id: deviceId, createdAt: '2026-09-29T00:00:00.000Z',
    organizationId: 'org-1', deviceUuid: String(row.device_uuid), displayName: String(row.display_name),
    hostname: String(row.hostname), operatingSystem: String(row.operating_system), osVersion: String(row.os_version),
    rustdeskId: String(row.rustdesk_id), agentVersion: String(row.agent_version),
    rustdeskVersion: String(row.rustdesk_version), lastSeenAt: String(row.last_seen_at), enabled: false }],
    hasMore: false }) }, new Date('2026-09-30T12:01:00.000Z'), Buffer.alloc(32, 7));
  assert.equal(page.devices[0]?.status, 'OFFLINE');
});

test('failed freeze verification keeps the process blocked and reports manual recovery', async () => {
  const f = storage(); f.deferDevice(); f.failFreeze();
  const running = f.service();
  await assert.rejects(running(hash, body, '192.0.2.1'),
    (error: unknown) => error instanceof HeartbeatError && error.code === 'HEARTBEAT_UNAVAILABLE' && error.recoveryRequired);
  await assert.rejects(running(hash, body, '192.0.2.1'),
    (error: unknown) => error instanceof HeartbeatError && error.code === 'HEARTBEAT_UNAVAILABLE' && error.recoveryRequired);
  assert.ok(f.submitted.some(({ kind, changes }) => kind === 'devices' && changes.enabled === false));
  assert.ok(f.submitted.some(({ kind, changes }) => kind === 'device_tokens' && changes.revoked_at === firstTime));
});

test('indeterminate token last-used PATCH cannot un-revoke after a replacement service rejects the device', async () => {
  const f = storage(); f.deferToken();
  await assert.rejects(f.service()(hash, body, '192.0.2.1'),
    (error: unknown) => error instanceof HeartbeatError && error.recoveryRequired);
  await assert.rejects(f.service('2026-09-30T12:01:00.000Z')(hash, body, '192.0.2.2'),
    (error: unknown) => error instanceof HeartbeatError && error.code === 'UNAUTHENTICATED');
  f.releaseToken();
  assert.equal(f.rows.get(`devices/${deviceId}`)?.enabled, false);
  assert.equal(f.rows.get(`device_tokens/${deviceId}`)?.revoked_at, firstTime);
  assert.equal(f.rows.get(`device_tokens/${deviceId}`)?.last_used_at, firstTime);
  assert.deepEqual(f.submitted.filter(({ kind, changes }) => kind === 'device_tokens' && 'last_used_at' in changes)
    .map(({ changes }) => Object.keys(changes)), [['last_used_at']]);
});

test('known token write failure clears every optional heartbeat field that was absent before the request', async () => {
  const f = storage(true); f.failToken();
  const beforeDevice = await f.repository.snapshot('devices', deviceId);
  const beforeToken = await f.repository.snapshot('device_tokens', deviceId);
  await assert.rejects(f.service()(hash, body, '192.0.2.1'),
    (error: unknown) => error instanceof HeartbeatError && !error.recoveryRequired);
  assert.equal(sameEnrollmentState('devices', await f.repository.snapshot('devices', deviceId), beforeDevice), true);
  assert.equal(sameEnrollmentState('device_tokens', await f.repository.snapshot('device_tokens', deviceId), beforeToken), true);
  for (const field of ['agent_version', 'rustdesk_version', 'last_seen_at', 'last_ip']) {
    assert.equal(f.rows.get(`devices/${deviceId}`)?.[field], undefined);
  }
  assert.equal(f.rows.get(`devices/${deviceId}`)?.os_version, '11');
  assert.equal(f.rows.get(`device_tokens/${deviceId}`)?.last_used_at, undefined);
});

test('an adapter that ignores optional clears reports recoveryRequired and freezes the device', async () => {
  const f = storage(true); f.failToken(); f.ignoreClears();
  await assert.rejects(f.service()(hash, body, '192.0.2.1'),
    (error: unknown) => error instanceof HeartbeatError && error.recoveryRequired);
  assert.equal(f.rows.get(`devices/${deviceId}`)?.enabled, false);
  assert.equal(f.rows.get(`device_tokens/${deviceId}`)?.revoked_at, firstTime);
});

for (const omitted of [true, false]) test(`failed verification restores ${omitted ? 'omitted' : 'null'} optional fields`, async () => {
  const f = storage(omitted); f.failVerify();
  const beforeDevice = await f.repository.snapshot('devices', deviceId);
  const beforeToken = await f.repository.snapshot('device_tokens', deviceId);
  await assert.rejects(f.service()(hash, body, '192.0.2.1'),
    (error: unknown) => error instanceof HeartbeatError && !error.recoveryRequired);
  assert.equal(sameEnrollmentState('devices', await f.repository.snapshot('devices', deviceId), beforeDevice), true);
  assert.equal(sameEnrollmentState('device_tokens', await f.repository.snapshot('device_tokens', deviceId), beforeToken), true);
  for (const field of ['agent_version', 'rustdesk_version', 'last_seen_at', 'last_ip']) {
    assert.equal(f.rows.get(`devices/${deviceId}`)?.[field], omitted ? undefined : (field.endsWith('version') ? '1' : null));
  }
  assert.equal(f.rows.get(`device_tokens/${deviceId}`)?.last_used_at, omitted ? undefined : null);
});

for (const mode of ['late-before', 'late-after'] as const) {
  test(`late audit create ${mode} retry is reconciled under one deterministic ID without rolling back heartbeat`, async () => {
    const f = storage(); f.auditMode(mode);
    assert.deepEqual(await f.service()(hash, body, '192.0.2.1'), { deviceId, lastSeenAt: firstTime });
    f.releaseAudit();
    const audits = [...f.rows].filter(([key]) => key.startsWith('audit_logs/'));
    assert.equal(audits.length, 1);
    assert.equal(audits[0]![1].action, 'device.heartbeat');
    assert.equal(f.rows.get(`devices/${deviceId}`)?.last_seen_at, firstTime);
    assert.equal(f.rows.get(`device_tokens/${deviceId}`)?.last_used_at, firstTime);
  });
}

test('definite audit rejection returns unavailable but retains confirmed heartbeat metadata', async () => {
  const f = storage(); f.auditMode('definite');
  await assert.rejects(f.service()(hash, body, '192.0.2.1'),
    (error: unknown) => error instanceof HeartbeatError && error.code === 'HEARTBEAT_UNAVAILABLE');
  assert.equal(f.rows.get(`devices/${deviceId}`)?.last_seen_at, firstTime);
  assert.equal(f.rows.get(`device_tokens/${deviceId}`)?.last_used_at, firstTime);
});

test('an unresolved audit create can arrive after 503 without contradicting retained heartbeat state', async () => {
  const f = storage(); f.auditMode('late-both');
  await assert.rejects(f.service()(hash, body, '192.0.2.1'),
    (error: unknown) => error instanceof HeartbeatError && error.recoveryRequired);
  assert.equal(f.rows.get(`devices/${deviceId}`)?.last_seen_at, firstTime);
  f.releaseAudit();
  const audits = [...f.rows].filter(([key]) => key.startsWith('audit_logs/'));
  assert.equal(audits.length, 1);
  assert.equal(audits[0]![1].result, 'success');
});

test('a repeated heartbeat identity uses the same success-audit ID', async () => {
  const f = storage();
  await f.service()(hash, body, '192.0.2.1');
  await f.service()(hash, body, '192.0.2.1');
  assert.equal([...f.rows.keys()].filter((key) => key.startsWith('audit_logs/')).length, 1);
});

test('conflicting audit document at the deterministic ID is never accepted as this heartbeat', async () => {
  const f = storage();
  const event = { organizationId: 'org-1', deviceId, sourceIp: '192.0.2.1', result: 'success' as const,
    recoveryRequired: false };
  await f.audit.recordHeartbeat('same-id', event);
  await f.audit.recordHeartbeat('same-id', event);
  await assert.rejects(f.audit.recordHeartbeat('same-id', { ...event, sourceIp: '192.0.2.2' }),
    /^Error: Heartbeat audit unavailable$/);
});
