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
  const updates: Array<{ kind: string; data: Record<string, unknown> }> = [];
  const normalize = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).map(([k, v]) =>
    [k, typeof v === 'string' && ['last_seen_at', 'expires_at', 'last_used_at', 'revoked_at'].includes(k)
      ? new Date(v).toISOString().replace('Z', '+00:00') : v]));
  const db = {
    async getDocument(_database: string, kind: string, id: string) {
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
      if (kind === 'audit_logs' && rejectAudit) throw new AppwriteException('audit unavailable', 400);
      if (rows.has(`${kind}/${id}`)) throw new AppwriteException('conflict', 409);
      rows.set(`${kind}/${id}`, normalize(data)); return { $id: id, ...data };
    },
    async updateDocument(_database: string, kind: string, id: string, data: Record<string, unknown>) {
      updates.push({ kind, data: structuredClone(data) });
      if (kind === 'enrollment_tokens' && data.active === false && commitOnFreeze) late?.();
      const commit = () => rows.set(`${kind}/${id}`, { ...rows.get(`${kind}/${id}`), ...normalize(data) });
      if (kind === delayedKind && (delayedCount === undefined || data.use_count === delayedCount)) {
        delayedKind = ''; late = commit; throw new Error('synthetic network timeout');
      }
      commit(); return { $id: id, ...rows.get(`${kind}/${id}`) };
    },
    async deleteDocument(_database: string, kind: string, id: string) { rows.delete(`${kind}/${id}`); },
  } as unknown as Databases;
  const repository = createEnrollmentRepository(db);
  const newService = () => createEnrollmentService({ repository, audit: createAuditRepository(db), encryptionKey: key,
    keyVersion: 1, now: () => new Date('2026-10-01T00:00:00Z') });
  return { rows, updates, repository, newService, delay: (kind: string, count?: number) => { delayedKind = kind; delayedCount = count; },
    complete: () => { assert.ok(late); late(); }, rejectAudit: () => { rejectAudit = true; },
    completeOnFreeze: () => { commitOnFreeze = true; } };
}

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
  const result = await enroll(input, '127.0.0.1');
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

test('uncertain credential rotation blocks another rotation until its exact expected envelope is observed', async () => {
  const f = fixture(); const enroll = f.newService(); const first = await enroll(input, '127.0.0.1');
  f.delay('device_credentials');
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError);
  const before = structuredClone(f.rows.get(`device_credentials/${deviceId}`));
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError);
  assert.deepEqual(f.rows.get(`device_credentials/${deviceId}`), before);
  f.complete(); const recovered = await enroll(input, '127.0.0.1');
  assert.notEqual(first.deviceToken, recovered.deviceToken);
  assert.equal(f.rows.get(`device_tokens/${deviceId}`)?.token_hash, hashToken(recovered.deviceToken));
  assert.equal(f.rows.get('enrollment_tokens/token')!.use_count, 1);
  assert.equal(f.rows.get('enrollment_tokens/token')!.active, false);
});

test('a process restart cannot guess the outcome of an uncertain credential update', async () => {
  const f = fixture(); const enroll = f.newService(); await enroll(input, '127.0.0.1'); f.delay('device_credentials');
  await assert.rejects(enroll(input, '127.0.0.1'), EnrollmentError);
  await assert.rejects(f.newService()(input, '127.0.0.1'), EnrollmentError);
  f.complete(); await assert.rejects(f.newService()(input, '127.0.0.1'), EnrollmentError);
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
