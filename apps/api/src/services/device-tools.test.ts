import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { AppwriteException, type Databases } from 'node-appwrite';
import { createOperatorSetupService } from './operator-setup.ts';
import { createConnectionLaunch } from './connection-launch.ts';
import { createAuditRepository, type ConnectionAuditRecord, type OperatorAudit, type OperatorAuditRepository } from '../repositories/audit.ts';
import { createSetupReceiptRepository } from '../repositories/operator-setup.ts';
import { createEnrollmentRepository, IndeterminateEnrollmentWrite, RejectedEnrollmentWrite, sameEnrollmentState,
  type EnrollmentData, type EnrollmentKind, type EnrollmentRepository } from '../repositories/enrollment.ts';
import type { AuthenticatedTechnician } from '../plugins/technician-auth.ts';
import { encryptPassword } from '../security/credentials.ts';

const now = new Date('2026-10-01T23:00:00.000Z');
const technician: AuthenticatedTechnician = { userId: 'operator', displayName: 'Operator', globalRole: null,
  organizations: [{ id: 'org', name: 'Customer', slug: 'customer', active: true }],
  authorization: [{ organizationId: 'org', role: 'admin', canView: true, canConnect: true, canManageDevices: true }] };
function fixture() {
  const reads: string[] = []; const rows = new Map<string, EnrollmentData>();
  const audits = new Map<string, OperatorAudit>(); let locked = false; let uncertain = false; let failAudit: boolean | string = false;
  const repo = { snapshot: async (kind: EnrollmentKind, id: string) => { reads.push(kind); return rows.get(`${kind}/${id}`) ?? null; },
    organizationActive: async () => true } as unknown as EnrollmentRepository;
  const audit: OperatorAuditRepository = {
    recordOperator: async (id, event) => {
      if (failAudit === true || failAudit === event.action || audits.has(id) && event.action !== 'device.connect.event') throw new Error('synthetic-private-error');
      audits.set(id, structuredClone(event));
    },
    connectionAttempt: async (id) => {
      const row = audits.get(id);
      return row?.connection ? { organizationId: row.organizationId, actorId: row.actorId, deviceId: row.deviceId!,
        action: row.action as ConnectionAuditRecord['action'], result: row.result ?? 'success',
        event: { ...row.connection, id, at: now.toISOString() } } : null;
    },
    connectionHistory: async () => Promise.all([...audits.keys()].filter((id) => audits.get(id)?.connection)
      .map(async (id) => (await audit.connectionAttempt!(id))!)),
  };
  const receipts = { committedReceipts: async () => [], heartbeatPending: async () => locked,
    updateDeviceFields: async (id: string, data: { displayName: string; notes: string }) => {
      assert.equal(locked, true);
      if (uncertain) throw new IndeterminateEnrollmentWrite();
      Object.assign(rows.get(`devices/${id}`)!, { display_name: data.displayName, notes: data.notes });
    } };
  const guard = { beginHeartbeatGuard: async () => { if (locked) return false; locked = true; return true; },
    endHeartbeatGuard: async () => { locked = false; return true; } };
  const key = Buffer.alloc(32, 5); const envelope = encryptPassword('synthetic-password', key);
  rows.set('devices/device', { organization_id: 'org', device_uuid: '7784f4e1-941c-45c0-8285-b84e71cf2a5a',
    display_name: 'PC', hostname: 'PC', operating_system: 'Windows', os_version: '11', rustdesk_id: '123456789',
    agent_version: '1.0.3', rustdesk_version: '1.4.9', enabled: true, last_seen_at: now.toISOString(), last_ip: '127.0.0.1' });
  rows.set('device_tokens/device', { device_id: 'device', token_hash: 'a'.repeat(64), last_used_at: now.toISOString(), revoked_at: null });
  rows.set('device_credentials/device', { device_id: 'device', password_ciphertext: envelope.passwordCiphertext,
    password_nonce: envelope.passwordNonce, password_tag: envelope.passwordTag, key_version: envelope.keyVersion });
  const service = createOperatorSetupService({ repository: repo, receipts, audit, guard,
    encryptionKey: key, keyVersion: 1, now: () => now });
  return { service, rows, reads, audits, audit, repo, receipts, guard,
    isLocked: () => locked, lock: () => { locked = true; }, uncertain: () => { uncertain = true; },
    failAudit: (action?: string) => { failAudit = action ?? true; } };
}

test('manual launch reads no credentials, permits diagnostics while agent offline, and binds audit to the attempt', async () => {
  const f = fixture(); f.rows.get('devices/device')!.last_seen_at = null;
  const attemptId = randomUUID(); const response = await f.service.connectWithOptions!(technician, 'device', { mode: 'manual', attemptId }, '127.0.0.1');
  assert.equal(response.attemptId, attemptId); assert.equal(response.mode, 'manual');
  const uri = new URL(response.launchUri);
  assert.equal(uri.pathname, '/123456789@179.199.142.157:21116'); assert.equal(uri.searchParams.has('password'), false);
  assert.equal(f.reads.includes('device_credentials'), false);
  assert.deepEqual(f.audits.get(attemptId)?.connection, { mode: 'manual', attemptId, stage: 'authorized', code: 'LAUNCH_AUTHORIZED', source: 'api' });
});

test('automatic preserves existing connect and audit; logs never contain its transient handoff', async () => {
  const f = fixture(); const attemptId = randomUUID();
  const response = await f.service.connectWithOptions!(technician, 'device', { mode: 'automatic', attemptId }, '127.0.0.1');
  assert.equal(new URL(response.launchUri).searchParams.get('password'), 'synthetic-password');
  assert.equal(f.audits.get(attemptId)?.connection?.stage, 'authorized');
  const serialized = JSON.stringify([...f.audits.values()]);
  for (const value of ['rustdesk://', 'synthetic-password', 'password_ciphertext', 'password_nonce', 'token_hash']) assert.ok(!serialized.includes(value));
  await assert.rejects(f.service.connectWithOptions!(technician, 'device', { mode: 'automatic', attemptId }, '127.0.0.1'));
});

test('new automatic wrapper calls existing connect without changing its payload and never releases before its own audit', async () => {
  const f = fixture(); let called = 0;
  const existingResponse = { launchUri: 'rustdesk://connect/123456789@179.199.142.157:21116?key=fixture&password=fixture' };
  const connect = createConnectionLaunch({ repository: f.repo, receipts: f.receipts, audit: f.audit, now: () => now,
    connectAutomatic: async () => { called++; return existingResponse; } });
  const result = await connect(technician, 'device', { mode: 'automatic', attemptId: randomUUID() }, '127.0.0.1');
  assert.equal(result.launchUri, existingResponse.launchUri); assert.equal(called, 1);
  f.failAudit(); await assert.rejects(connect(technician, 'device', { mode: 'automatic', attemptId: randomUUID() }, '127.0.0.1'));
});

test('permission/tenant checks protect every device tool, with safe rejection audit only inside visible organization', async () => {
  const f = fixture(); const viewer = { ...technician, authorization: [{ ...technician.authorization[0]!, canConnect: false, canManageDevices: false }] };
  const attemptId = randomUUID();
  await assert.rejects(f.service.connectWithOptions!(viewer, 'device', { mode: 'manual', attemptId }, '127.0.0.1'));
  assert.equal(f.audits.get(attemptId)?.connection?.code, 'ACCESS_DENIED');
  await assert.rejects(f.service.update!(viewer, 'device', { displayName: 'New', notes: '' }, '127.0.0.1'));
  assert.equal(f.reads.includes('device_credentials'), false);
  const outsider = { ...technician, organizations: [], authorization: [] };
  for (const operation of [() => f.service.details!(outsider, 'device'), () => f.service.connectionHistory!(outsider, 'device'),
    () => f.service.update!(outsider, 'device', { displayName: 'New', notes: '' }, '127.0.0.1'),
    () => f.service.connectWithOptions!(outsider, 'device', { mode: 'manual', attemptId: randomUUID() }, '127.0.0.1'),
    () => f.service.connectionEvent!(outsider, 'device', { attemptId, mode: 'manual', event: 'launch_requested' }, '127.0.0.1')]) {
    await assert.rejects(operation());
  }
  assert.equal(f.audits.size, 1);
});

test('automatic failure is classified and recorded without error text, credential reads or misleading session status', async () => {
  for (const [mutation, code] of [[{ enabled: false }, 'ACCESS_DENIED'], [{ rustdesk_id: 'bad@id' }, 'INVALID_RUSTDESK_ID'],
    [{ last_seen_at: null }, 'DEVICE_OFFLINE']] as const) {
    const f = fixture(); Object.assign(f.rows.get('devices/device')!, mutation); const attemptId = randomUUID();
    await assert.rejects(f.service.connectWithOptions!(technician, 'device', { mode: 'automatic', attemptId }, '127.0.0.1'));
    assert.equal(f.audits.get(attemptId)?.connection?.code, code); assert.equal(f.audits.get(attemptId)?.result, 'failure');
    assert.equal(f.reads.includes('device_credentials'), false);
  }
  const f = fixture(); f.lock(); const attemptId = randomUUID();
  await assert.rejects(f.service.connectWithOptions!(technician, 'device', { mode: 'automatic', attemptId }, '127.0.0.1'));
  assert.equal(f.audits.get(attemptId)?.connection?.code, 'HEARTBEAT_UNCONFIRMED');
});

test('details project diagnostics and notes only; editing preserves identity, presence, versions and both credential records', async () => {
  const f = fixture(); const before = structuredClone([...f.rows]);
  const details = await f.service.details!(technician, 'device');
  assert.equal(details.notes, ''); assert.deepEqual(details.diagnostics, { agentOnline: true, heartbeatConfirmed: true,
    rustdeskIdValid: true, credentialAvailable: true });
  const response = await f.service.update!(technician, 'device', { displayName: ' New name ', notes: 'Customer location\nSupport extension' }, '127.0.0.1');
  assert.equal(response.device.displayName, 'New name'); assert.equal(response.notes, 'Customer location\nSupport extension');
  assert.equal(f.isLocked(), false);
  const expected = new Map(before); Object.assign(expected.get('devices/device')!, { display_name: 'New name', notes: response.notes });
  assert.deepEqual([...f.rows], [...expected]);
  assert.equal(JSON.stringify([...f.audits.values()]).includes('Support extension'), false);
  assert.equal(JSON.stringify(details).includes('ciphertext'), false);
});

test('edits refuse a concurrent heartbeat; unknown writes preserve the durable guard', async () => {
  const f = fixture(); f.lock();
  await assert.rejects(f.service.update!(technician, 'device', { displayName: 'New', notes: '' }, '127.0.0.1'), { code: 'DEVICE_BUSY' });
  assert.equal(f.rows.get('devices/device')!.display_name, 'PC');
  const uncertain = fixture(); uncertain.uncertain();
  await assert.rejects(uncertain.service.update!(technician, 'device', { displayName: 'New', notes: '' }, '127.0.0.1'));
  assert.equal(uncertain.isLocked(), true);
});

test('known metadata failures and audit failures release the guard without rolling back a confirmed edit', async () => {
  for (const stage of ['device.update.requested', 'device.update', 'rejected-patch']) {
    const f = fixture();
    if (stage === 'rejected-patch') f.receipts.updateDeviceFields = async () => { throw new RejectedEnrollmentWrite(); };
    else f.failAudit(stage);
    await assert.rejects(f.service.update!(technician, 'device', { displayName: 'New', notes: 'Note' }, '127.0.0.1'));
    assert.equal(f.isLocked(), false);
    assert.equal(f.rows.get('devices/device')!.display_name, stage === 'device.update' ? 'New' : 'PC');
  }
});

test('connection follow-ups bind actor, device, organization, mode, successful authorization and thirty-minute lifetime', async () => {
  const f = fixture(); const attemptId = randomUUID();
  await f.service.connectWithOptions!(technician, 'device', { mode: 'manual', attemptId }, '127.0.0.1');
  const request = { attemptId, mode: 'manual' as const, event: 'session_confirmed' as const };
  await f.service.connectionEvent!(technician, 'device', request, '127.0.0.1');
  const history = await f.service.connectionHistory!(technician, 'device');
  assert.equal(history.events.length, 2); assert.equal(history.events[1]!.source, 'operator');
  assert.equal(history.events[1]!.code, 'OPERATOR_SESSION_CONFIRMED');
  // A duplicate event does not grow the journal.
  await f.service.connectionEvent!(technician, 'device', request, '127.0.0.1'); assert.equal(f.audits.size, 2);
  await assert.rejects(f.service.connectionEvent!({ ...technician, userId: 'other' }, 'device', request, '127.0.0.1'));
  await assert.rejects(f.service.connectionEvent!(technician, 'device', { ...request, mode: 'automatic' }, '127.0.0.1'));
  await assert.rejects(f.service.connectionEvent!(technician, 'device', { ...request, attemptId: randomUUID() }, '127.0.0.1'));
  await assert.rejects(f.service.connectionEvent!(technician, 'device', { ...request, code: 'APP_NOT_OPENED' }, '127.0.0.1'));
  const real = f.audit.connectionAttempt!;
  for (const mutation of [{ organizationId: 'other' }, { deviceId: 'other' }, { result: 'failure' as const },
    { event: { ...history.events[0]!, at: '2026-10-01T22:29:59Z' } }, { event: { ...history.events[0]!, at: '2026-10-02T00:00:00Z' } }]) {
    f.audit.connectionAttempt = async (id) => ({ ...(await real(id))!, ...mutation });
    await assert.rejects(f.service.connectionEvent!(technician, 'device', request, '127.0.0.1'));
  }
});

test('device metadata repository issues only a narrow PATCH and resolves a lost acknowledgment through exact readback', async () => {
  let patch: unknown; let saved = { display_name: 'old', notes: null as string | null }; let lost = false;
  const databases = { updateDocument: async (_database: string, _collection: string, _id: string, data: typeof saved) => {
    patch = data; saved = data; if (lost) throw new Error('synthetic-private-network-error'); return {};
  }, getDocument: async () => saved } as unknown as Databases;
  const repo = createSetupReceiptRepository(databases);
  await repo.updateDeviceFields!('device', { displayName: 'new', notes: 'support' });
  assert.deepEqual(patch, { display_name: 'new', notes: 'support' });
  lost = true; await repo.updateDeviceFields!('device', { displayName: 'newer', notes: '' });
  assert.equal(saved.display_name, 'newer');
});

test('audit repository projects only fixed metadata and excludes unrelated, malformed and legacy records', async () => {
  const documents = new Map<string, Record<string, unknown>>(); let lastQueries: string[] = [];
  const databases = {
    createDocument: async (_database: string, _collection: string, id: string, data: Record<string, unknown>) => {
      if (documents.has(id)) throw new AppwriteException('conflict', 409);
      documents.set(id, { ...data, $id: id, $createdAt: now.toISOString() });
    }, getDocument: async (_database: string, _collection: string, id: string) => {
      const doc = documents.get(id); if (!doc) throw new AppwriteException('not found', 404); return doc;
    }, listDocuments: async (_database: string, _collection: string, queries: string[]) => {
      lastQueries = queries; return { documents: [...documents.values()] };
    },
  } as unknown as Databases;
  const audit = createAuditRepository(databases); const attemptId = randomUUID();
  const event: OperatorAudit = { organizationId: 'org', actorId: 'operator', deviceId: 'device', sourceIp: '127.0.0.1',
    action: 'device.connect', connection: { attemptId, mode: 'manual', stage: 'authorized', code: 'LAUNCH_AUTHORIZED', source: 'api' } };
  await audit.recordOperator(attemptId, event);
  const record = await audit.connectionAttempt!(attemptId); assert.equal(record?.event.attemptId, attemptId);
  documents.set('legacy', { ...documents.get(attemptId), $id: 'legacy', metadata_json: '{}' });
  documents.set('bad', { ...documents.get(attemptId), $id: 'bad', metadata_json: JSON.stringify({ ...event.connection, password: 'synthetic-forbidden' }) });
  assert.equal((await audit.connectionHistory!('device')).length, 1);
  const queries = lastQueries.map((value) => JSON.parse(value));
  assert.ok(queries.some((value) => value.method === 'limit' && value.values[0] === 30));
  assert.ok(queries.some((value) => value.attribute === 'action' && value.values.length === 2));
  await assert.rejects(audit.recordOperator(attemptId, event));
});

test('optional notes normalize absent/null consistently and agent writes preserve notes without patching them', async () => {
  assert.equal(sameEnrollmentState('devices', { display_name: 'PC' }, { display_name: 'PC', notes: null }), true);
  let patch: unknown;
  const repo = createEnrollmentRepository({ updateDocument: async (_db: string, _collection: string, _id: string, data: unknown) => { patch = data; } } as unknown as Databases);
  const old = { display_name: 'PC', notes: 'support', last_seen_at: now.toISOString() };
  await repo.write('devices', 'device', { ...old, last_seen_at: '2026-10-01T23:00:30Z' }, old);
  assert.deepEqual(patch, { last_seen_at: '2026-10-01T23:00:30.000Z' });
  await repo.write('devices', 'device', { ...old, display_name: 'New installer name' }, old);
  assert.deepEqual(patch, { display_name: 'New installer name' });
});
