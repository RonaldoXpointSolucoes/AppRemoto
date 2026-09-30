import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppwriteException, type Databases } from 'node-appwrite';
import { createEnrollmentRepository, enrollmentId } from '../repositories/enrollment.ts';
import { createAuditRepository } from '../repositories/audit.ts';
import { createEnrollmentService, EnrollmentError } from './enroll-device.ts';
import { hashToken } from '../security/tokens.ts';
import { decryptPassword } from '../security/credentials.ts';

const input = { enrollmentToken: 'synthetic-enrollment-token-123456789', deviceUuid: '00000000-0000-4000-8000-000000000001',
  displayName: 'PC', hostname: 'pc', operatingSystem: 'Windows', osVersion: '11', agentVersion: '1', rustdeskId: '123', rustdeskVersion: '1' };
const key = Buffer.alloc(32, 7);
const deviceId = enrollmentId('device', 'org', input.deviceUuid);
const receiptId = enrollmentId('receipt', 'token', input.deviceUuid);

function fixture() {
  const rows = new Map<string, Record<string, unknown>>();
  rows.set('organizations/org', { active: true });
  rows.set('enrollment_tokens/token', { organization_id: 'org', token_hash: hashToken(input.enrollmentToken),
    expires_at: '2030-01-01T00:00:00.000+00:00', max_uses: 3, use_count: 0, active: true, created_by_user_id: 'admin' });
  let delayedKind = ''; let delayedCount: number | undefined; let late: (() => void) | undefined; let rejectAudit = false;
  let commitOnFreeze = false;
  let adminDisableOnDelay = false; let rejectFreeze = false;
  let adminPhase = ''; let freezeWritten = false;
  const revoke = () => Object.assign(rows.get('enrollment_tokens/token')!, { active: false, revoked_at: '2026-10-01T00:00:01.000Z' });
  const updates: Array<{ kind: string; data: Record<string, unknown> }> = [];
  const normalize = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).map(([k, v]) =>
    [k, typeof v === 'string' && ['last_seen_at', 'expires_at', 'last_used_at', 'revoked_at'].includes(k)
      ? new Date(v).toISOString().replace('Z', '+00:00') : v]));
  const db = {
    async getDocument(_database: string, kind: string, id: string) {
      if (kind === 'enrollment_tokens' && freezeWritten && adminPhase === 'before-marker') { revoke(); adminPhase = ''; }
      const doc = rows.get(`${kind}/${id}`); if (!doc) throw new AppwriteException('not found', 404);
      return { $id: id, ...structuredClone(doc) };
    },
    async listDocuments(_database: string, kind: string, queries: string[]) {
      const filters = queries.map((q) => JSON.parse(q)).filter((q) => q.method === 'equal');
      const documents = [...rows].filter(([path, doc]) => path.startsWith(`${kind}/`) && filters.every((q) => q.values.includes(doc[q.attribute])))
        .map(([path, doc]) => ({ $id: path.split('/')[1], ...structuredClone(doc) }));
      return { documents, total: documents.length };
    },
    async createDocument(_database: string, kind: string, id: string, data: Record<string, unknown>) {
      if (kind === 'enrollment_receipts') {
        assert.equal(typeof data.recovery_frozen, 'boolean'); assert.equal(Number.isInteger(data.expected_use_count), true);
      }
      if (kind === 'audit_logs' && rejectAudit) throw new AppwriteException('audit unavailable', 400);
      if (rows.has(`${kind}/${id}`)) throw new AppwriteException('conflict', 409);
      rows.set(`${kind}/${id}`, normalize(data)); return { $id: id, ...data };
    },
    async updateDocument(_database: string, kind: string, id: string, data: Record<string, unknown>) {
      updates.push({ kind, data: structuredClone(data) });
      if (kind === 'enrollment_tokens' && data.active === false && adminPhase === 'before-write') { revoke(); adminPhase = ''; }
      if (kind === 'enrollment_tokens' && data.active === false && rejectFreeze) throw new AppwriteException('rejected', 400);
      if (kind === 'enrollment_tokens' && data.active === false && commitOnFreeze) late?.();
      const commit = () => rows.set(`${kind}/${id}`, { ...rows.get(`${kind}/${id}`), ...normalize(data) });
      if (kind === delayedKind && (delayedCount === undefined || data.use_count === delayedCount)) {
        if (adminDisableOnDelay) rows.get('enrollment_tokens/token')!.active = false;
        delayedKind = ''; late = commit; throw new Error('synthetic network timeout');
      }
      commit();
      if (kind === 'enrollment_tokens' && data.active === false) freezeWritten = true;
      if (kind === 'enrollment_receipts' && data.recovery_frozen === true && adminPhase === 'after-marker') { revoke(); adminPhase = ''; }
      return { $id: id, ...rows.get(`${kind}/${id}`) };
    },
    async deleteDocument(_database: string, kind: string, id: string) { rows.delete(`${kind}/${id}`); },
  } as unknown as Databases;
  const repository = createEnrollmentRepository(db);
  const newService = (encryptionKey = key) => createEnrollmentService({ repository, audit: createAuditRepository(db), encryptionKey,
    keyVersion: 1, now: () => new Date('2026-10-01T00:00:00Z') });
  return { rows, updates, repository, newService, delay: (kind: string, count?: number) => { delayedKind = kind; delayedCount = count; },
    complete: () => { assert.ok(late); late(); }, rejectAudit: () => { rejectAudit = true; },
    completeOnFreeze: () => { commitOnFreeze = true; },
    adminRevoke: (phase: string) => { adminPhase = phase; }, revoke,
    adminDisableOnDelay: () => { adminDisableOnDelay = true; }, rejectFreeze: () => { rejectFreeze = true; } };
}

for (const phase of ['before-write', 'before-marker', 'after-marker']) test(`administrative revocation wins ${phase} race with freeze`, async () => {
  const f = fixture(); const enroll = f.newService(); f.delay('enrollment_tokens'); f.adminRevoke(phase);
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError); f.complete();
  assert.ok(f.rows.get('enrollment_tokens/token')!.revoked_at);
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError);
  await assert.rejects(f.newService()(input, '127.0.0.1'), EnrollmentError);
  if (phase !== 'after-marker') assert.equal(f.rows.get(`enrollment_receipts/${receiptId}`)!.recovery_frozen, false);
  assert.ok(f.updates.filter((u) => u.kind === 'enrollment_tokens').every((u) => !('revoked_at' in u.data)));
});

test('administrative revocation remains authoritative over a committed frozen replay', async () => {
  const f = fixture(); const enroll = f.newService(); f.delay('enrollment_tokens');
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError); f.complete(); await enroll(input, '127.0.0.1');
  f.revoke(); const writes = f.updates.length;
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError);
  await assert.rejects(f.newService()(input, '127.0.0.1'), EnrollmentError);
  assert.equal(f.updates.length, writes);
});

test('committed replay rechecks administrative revocation after credential validation', async () => {
  const f = fixture(); const enroll = f.newService(); await enroll(input, '127.0.0.1');
  const snapshot = f.repository.snapshot;
  f.repository.snapshot = async (kind, id) => {
    if (kind === 'enrollment_tokens') f.revoke();
    return snapshot(kind, id);
  };
  const writes = f.updates.length;
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError);
  assert.equal(f.updates.length, writes);
});

for (const restart of [false, true]) test(`late consumption remains recoverable with real adapters; restart=${restart}`, async () => {
  const f = fixture(); let enroll = f.newService(); f.delay('enrollment_tokens');
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError);
  assert.equal(f.rows.get(`enrollment_receipts/${receiptId}`)?.expected_use_count, 1);
  assert.equal(f.rows.get(`enrollment_receipts/${receiptId}`)?.status, 'pending');
  for (const kind of ['devices', 'device_tokens', 'device_credentials']) assert.ok(f.rows.has(`${kind}/${deviceId}`));
  assert.equal(f.rows.get('enrollment_tokens/token')!.use_count, 0);
  assert.equal(f.rows.get('enrollment_tokens/token')!.active, false);
  if (restart) enroll = f.newService();
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError);
  await assert.rejects(enroll({ ...input, deviceUuid: '00000000-0000-4000-8000-000000000002' }, '127.0.0.1'), EnrollmentError);
  f.complete();
  assert.equal(f.rows.get('enrollment_tokens/token')!.active, false, 'late count write must not reactivate token');
  const originalArtifacts = ['devices', 'device_tokens', 'device_credentials'].map((kind) => structuredClone(f.rows.get(`${kind}/${deviceId}`)));
  const result = await enroll(input, '127.0.0.1');
  assert.deepEqual(['devices', 'device_tokens', 'device_credentials'].map((kind) => f.rows.get(`${kind}/${deviceId}`)), originalArtifacts);
  assert.equal(f.rows.get('enrollment_tokens/token')!.use_count, 1);
  assert.equal(f.rows.get(`enrollment_receipts/${receiptId}`)?.status, 'committed');
  assert.equal(f.rows.get(`device_tokens/${deviceId}`)?.token_hash, hashToken(result.deviceToken));
  const credential = f.rows.get(`device_credentials/${deviceId}`)!;
  assert.equal(decryptPassword({ passwordCiphertext: credential.password_ciphertext, passwordNonce: credential.password_nonce,
    passwordTag: credential.password_tag, keyVersion: credential.key_version }, key), result.rustdeskPassword);
  f.complete();
  assert.equal(f.rows.get('enrollment_tokens/token')!.active, false, 'late replay after finalization cannot reactivate');
  assert.equal(f.rows.get(`device_tokens/${deviceId}`)?.token_hash, hashToken(result.deviceToken));
  await assert.rejects(enroll({ ...input, deviceUuid: '00000000-0000-4000-8000-000000000002' }, '127.0.0.1'), EnrollmentError);
  assert.ok(f.updates.filter((u) => u.kind === 'enrollment_tokens' && 'use_count' in u.data)
    .every((u) => Object.keys(u.data).length === 1));
});

test('committed retry is denied without credential rotation, even when its PATCH would time out', async () => {
  const f = fixture(); const enroll = f.newService(); const first = await enroll(input, '127.0.0.1');
  f.delay('device_credentials'); const before = structuredClone([...f.rows].filter(([path]) => !path.startsWith('audit_logs/')));
  const writes = f.updates.length;
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError);
  await assert.rejects(f.newService()(input, '127.0.0.1'), EnrollmentError);
  assert.equal(f.updates.length, writes);
  assert.deepEqual([...f.rows].filter(([path]) => !path.startsWith('audit_logs/')), before);
  assert.ok(first.deviceToken);
});

test('committed denial cannot submit a late committed-to-pending update', async () => {
  const f = fixture(); await f.newService()(input, '127.0.0.1'); f.delay('enrollment_receipts');
  const writes = f.updates.length;
  await assert.rejects(f.newService()(input, '127.0.0.1'), EnrollmentError);
  await assert.rejects(f.newService()(input, '127.0.0.1'), EnrollmentError);
  assert.equal(f.updates.length, writes); assert.equal(f.rows.get(`enrollment_receipts/${receiptId}`)!.status, 'committed');
});

test('restarted read-only retry with a wrong master key fails without enrollment mutation', async () => {
  const f = fixture(); await f.newService()(input, '127.0.0.1'); const writes = f.updates.length;
  await assert.rejects(f.newService(Buffer.alloc(32, 99))(input, '127.0.0.1'), EnrollmentError);
  assert.equal(f.updates.length, writes);
});

test('Appwrite datetime offset normalization does not break known-failure compensation', async () => {
  const f = fixture(); f.rejectAudit();
  await assert.rejects(f.newService()(input, '127.0.0.1'), EnrollmentError);
  assert.equal(f.rows.get('enrollment_tokens/token')!.use_count, 0);
  for (const kind of ['devices', 'device_tokens', 'device_credentials']) assert.ok(!f.rows.has(`${kind}/${deviceId}`));
  assert.ok(!f.rows.has(`enrollment_receipts/${receiptId}`));
});

test('late consumption arriving during token deactivation still recovers without enabling another device', async () => {
  const f = fixture(); const enroll = f.newService(); f.delay('enrollment_tokens'); f.completeOnFreeze();
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError);
  assert.equal(f.rows.get('enrollment_tokens/token')!.active, false);
  assert.equal(f.rows.get('enrollment_tokens/token')!.use_count, 1);
  await enroll(input, '127.0.0.1');
  await assert.rejects(enroll({ ...input, deviceUuid: '00000000-0000-4000-8000-000000000002' }, '127.0.0.1'), EnrollmentError);
});

test('indeterminate rollback keeps remaining durable artifacts and freezes the token', async () => {
  const f = fixture(); f.rejectAudit(); f.delay('enrollment_tokens', 0);
  await assert.rejects(f.newService()(input, '127.0.0.1'), EnrollmentError);
  assert.equal(f.rows.get('enrollment_tokens/token')!.active, false);
  assert.ok(f.rows.has(`enrollment_receipts/${receiptId}`));
  for (const kind of ['devices', 'device_tokens', 'device_credentials']) assert.ok(f.rows.has(`${kind}/${deviceId}`));
  f.complete(); assert.equal(f.rows.get('enrollment_tokens/token')!.active, false);
});

test('invalid device on a pending receipt denies with audit but does not deactivate or change enrollment data', async () => {
  const f = fixture(); const enroll = f.newService(); await enroll(input, '127.0.0.1');
  Object.assign(f.rows.get(`enrollment_receipts/${receiptId}`)!, { status: 'pending', token_use_consumed: false });
  f.rows.get(`devices/${deviceId}`)!.enabled = false;
  const before = structuredClone([...f.rows].filter(([path]) => !path.startsWith('audit_logs/')));
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError);
  assert.deepEqual([...f.rows].filter(([path]) => !path.startsWith('audit_logs/')), before);
});

test('committed receipt target cannot be greater than the observed token count', async () => {
  const f = fixture(); const enroll = f.newService(); await enroll(input, '127.0.0.1');
  f.rows.get(`enrollment_receipts/${receiptId}`)!.expected_use_count = 2;
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError);
});

for (const restart of [false, true]) test(`frozen recovery returns once then denies replay; restart=${restart}`, async () => {
  const f = fixture(); let enroll = f.newService(); f.delay('enrollment_tokens');
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError); f.complete();
  const first = await enroll(input, '127.0.0.1');
  assert.equal(f.rows.get(`enrollment_receipts/${receiptId}`)!.recovery_frozen, true);
  if (restart) enroll = f.newService();
  const before = structuredClone([...f.rows].filter(([path]) => !path.startsWith('audit_logs/')));
  const writes = f.updates.length;
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError);
  assert.equal(f.updates.length, writes);
  assert.deepEqual([...f.rows].filter(([path]) => !path.startsWith('audit_logs/')), before);
  assert.equal(f.rows.get('enrollment_tokens/token')!.use_count, 1);
  assert.equal(f.rows.get('enrollment_tokens/token')!.active, false);
  assert.equal(f.rows.get(`device_tokens/${deviceId}`)!.token_hash, hashToken(first.deviceToken));
  const credential = f.rows.get(`device_credentials/${deviceId}`)!;
  assert.equal(decryptPassword({ passwordCiphertext: credential.password_ciphertext, passwordNonce: credential.password_nonce,
    passwordTag: credential.password_tag, keyVersion: credential.key_version }, key), first.rustdeskPassword);
});

for (const status of ['pending', 'committed']) test(`administratively disabled ${status} receipt does not acquire recovery provenance`, async () => {
  const f = fixture(); const enroll = f.newService(); await enroll(input, '127.0.0.1');
  assert.equal(f.rows.get(`enrollment_receipts/${receiptId}`)!.recovery_frozen, false);
  Object.assign(f.rows.get(`enrollment_receipts/${receiptId}`)!, { status, token_use_consumed: status === 'committed' });
  f.rows.get('enrollment_tokens/token')!.active = false;
  const before = structuredClone([...f.rows].filter(([path]) => !path.startsWith('audit_logs/')));
  await assert.rejects(f.newService()(input, '127.0.0.1'), (error: unknown) => error instanceof EnrollmentError && error.code === 'ENROLLMENT_DENIED');
  assert.deepEqual([...f.rows].filter(([path]) => !path.startsWith('audit_logs/')), before);
  const audit = [...f.rows].filter(([path]) => path.startsWith('audit_logs/')).at(-1)![1];
  assert.equal(JSON.parse(audit.metadata_json as string).reason, 'token_inactive');
});

test('receipt freeze provenance survives the repository snapshot and pending projection', async () => {
  const f = fixture(); const enroll = f.newService(); f.delay('enrollment_tokens');
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError);
  assert.equal((await f.repository.snapshot('enrollment_receipts', receiptId))!.recovery_frozen, true);
  assert.equal((await f.repository.pendingReceipts('token'))[0]!.recovery_frozen, true);
  const writes = f.updates.filter((u) => u.kind === 'enrollment_receipts' && u.data.recovery_frozen === true);
  assert.equal(writes.length, 1); assert.deepEqual(writes[0]!.data, { recovery_frozen: true });
  assert.ok(f.updates.indexOf(writes[0]!) > f.updates.findIndex((u) => u.kind === 'enrollment_tokens' && u.data.active === false));
});

test('live indeterminate handler never labels a preexisting administrative disable as its own freeze', async () => {
  const f = fixture(); const enroll = f.newService(); f.delay('enrollment_tokens'); f.adminDisableOnDelay();
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError); f.complete();
  assert.equal(f.rows.get(`enrollment_receipts/${receiptId}`)!.recovery_frozen, false);
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError);
  await assert.rejects(f.newService()(input, '127.0.0.1'), EnrollmentError);
});

test('rejected safety freeze never writes recovery provenance', async () => {
  const f = fixture(); const enroll = f.newService(); f.delay('enrollment_tokens'); f.rejectFreeze();
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError); f.complete();
  assert.equal(f.rows.get('enrollment_tokens/token')!.active, true);
  assert.equal(f.rows.get(`enrollment_receipts/${receiptId}`)!.recovery_frozen, false);
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError);
  assert.ok(!f.updates.some((u) => u.kind === 'enrollment_receipts' && u.data.recovery_frozen === true));
});

test('frozen committed retry still requires exact count and consumed receipt', async () => {
  const f = fixture(); const enroll = f.newService(); f.delay('enrollment_tokens');
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError); f.complete(); await enroll(input, '127.0.0.1');
  f.rows.get('enrollment_tokens/token')!.use_count = 2;
  await assert.rejects(f.newService()(input, '127.0.0.1'), EnrollmentError);
  f.rows.get('enrollment_tokens/token')!.use_count = 1;
  f.rows.get(`enrollment_receipts/${receiptId}`)!.token_use_consumed = false;
  await assert.rejects(f.newService()(input, '127.0.0.1'), EnrollmentError);
});
