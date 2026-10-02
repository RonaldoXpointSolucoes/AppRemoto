import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppwriteException, type Databases } from 'node-appwrite';
import { createEnrollmentRepository, enrollmentId } from './repositories/enrollment.ts';
import { createAuditRepository } from './repositories/audit.ts';

test('enrollment repository queries by hash, projects snapshots and restores exact expected state', async () => {
  const calls: unknown[][] = []; let doc: Record<string, unknown> | null = null;
  const databases = {
    async listDocuments(...args: unknown[]) {
      calls.push(args); return { total: 1, documents: [{ $id: 't', organization_id: 'o', token_hash: 'a'.repeat(64),
        expires_at: '2026-10-01T00:00:00Z', active: true, max_uses: 1, use_count: 0, created_by_user_id: 'u' }] };
    },
    async getDocument() { if (!doc) throw new AppwriteException('missing', 404); return { $id: 'd', $createdAt: 'metadata', ...doc }; },
    async createDocument(...args: unknown[]) { calls.push(args); doc = args[3] as Record<string, unknown>; return doc; },
    async updateDocument(...args: unknown[]) { calls.push(args); doc = args[3] as Record<string, unknown>; return doc; },
    async deleteDocument(...args: unknown[]) { calls.push(args); doc = null; },
  } as unknown as Databases;
  const repo = createEnrollmentRepository(databases);
  assert.equal((await repo.findToken('a'.repeat(64)))!.id, 't');
  const queries = (calls[0]![2] as string[]).map((q) => JSON.parse(q));
  assert.ok(queries.some((q) => q.method === 'equal' && q.attribute === 'token_hash' && q.values[0] === 'a'.repeat(64)));
  const before = await repo.snapshot('device_tokens', 'd'); assert.equal(before, null);
  const data = { device_id: 'd', token_hash: 'b'.repeat(64), last_used_at: null, revoked_at: null };
  await repo.write('device_tokens', 'd', data, null);
  assert.deepEqual(await repo.snapshot('device_tokens', 'd'), data);
  assert.deepEqual(calls.at(-1)!.slice(0, 3), ['remote_management', 'device_tokens', 'd']);
  assert.deepEqual(calls.at(-1)![4], []);
  await repo.restore('device_tokens', 'd', null, data); assert.equal(doc, null);
  doc = { ...data, token_hash: 'c'.repeat(64) };
  await assert.rejects(repo.restore('device_tokens', 'd', null, data), /Enrollment storage unavailable/);
  assert.ok(doc);
  assert.match(enrollmentId('receipt', 't', 'uuid'), /^[a-z0-9]{36}$/);
  assert.notEqual(enrollmentId('receipt', 'a:b', 'c'), enrollmentId('receipt', 'a', 'b:c'));
});

test('enrollment repository never treats upstream failures or conflicting duplicates as absence', async () => {
  const failing = createEnrollmentRepository({ getDocument: async () => { throw new Error('private'); },
    listDocuments: async () => ({ total: 2, documents: [{}, {}] }) } as unknown as Databases);
  await assert.rejects(failing.snapshot('devices', 'd'), /^Error: Enrollment storage unavailable$/);
  await assert.rejects(failing.findToken('a'.repeat(64)), /^Error: Enrollment storage unavailable$/);
});

test('freeze repeats authoritative active/unrevoked checks and returns the actual narrow PATCH response', async () => {
  const calls: string[] = []; const timestamp = '2026-10-01T00:00:01.000+00:00';
  const repo = createEnrollmentRepository({
    getDocument: async () => { calls.push('read'); return { token_hash: 'hash', active: true }; },
    updateDocument: async (...args: unknown[]) => {
      calls.push('write'); assert.deepEqual(args[3], { active: false });
      return { token_hash: 'hash', active: false, revoked_at: timestamp };
    },
  } as unknown as Databases);
  const result = await repo.freezeToken('token', 'hash');
  assert.deepEqual(calls, ['read', 'read', 'write']);
  assert.deepEqual(result, { token_hash: 'hash', active: false, revoked_at: '2026-10-01T00:00:01.000Z',
    generic_installer_id: null, bootstrap_request_hash: null });
});

test('freeze rejects revocation or inactivity observed by either precondition read', async () => {
  for (const changedRead of [1, 2]) for (const change of [{ active: false }, { revoked_at: '2026-10-01T00:00:00Z' }]) {
    let reads = 0;
    const repo = createEnrollmentRepository({
      getDocument: async () => ({ token_hash: 'hash', active: true, ...(++reads === changedRead ? change : {}) }),
      updateDocument: async () => assert.fail('must not freeze'),
    } as unknown as Databases);
    assert.equal(await repo.freezeToken('token', 'hash'), null);
  }
});

test('enrollment mutations cannot clear independent administrative revocation', async () => {
  const payloads: unknown[] = [];
  const repo = createEnrollmentRepository({ updateDocument: async (...args: unknown[]) => { payloads.push(args[3]); return {}; } } as unknown as Databases);
  await repo.write('enrollment_tokens', 'token', { use_count: 1, active: false, revoked_at: null },
    { use_count: 0, active: true, revoked_at: '2026-10-01T00:00:00Z' });
  assert.deepEqual(payloads, [{ use_count: 1, active: false }]);
});

test('audit persists only fixed nonsecret enrollment metadata and compensates missing document', async () => {
  const calls: unknown[][] = [];
  const audit = createAuditRepository({ createDocument: async (...args: unknown[]) => { calls.push(args); },
    deleteDocument: async () => { throw new AppwriteException('missing', 404); } } as unknown as Databases);
  await audit.record('audit-1', { organizationId: 'o', deviceId: 'd', sourceIp: '127.0.0.1', result: 'failure',
    retry: false, recoveryRequired: true });
  const persisted = calls[0]![3] as Record<string, unknown>;
  assert.equal(persisted.action, 'device.enroll');
  assert.deepEqual(JSON.parse(persisted.metadata_json as string), { retry: false, recoveryRequired: true });
  assert.deepEqual(calls[0]![4], []);
  await audit.remove('audit-1');
});
