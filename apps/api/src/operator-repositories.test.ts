import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppwriteException, type Databases } from 'node-appwrite';
import { createSetupReceiptRepository } from './repositories/operator-setup.ts';
import { createAuditRepository } from './repositories/audit.ts';

test('setup receipt query is bounded and correlated by token, never device name', async () => {
  let queries: Array<{ method: string; attribute?: string; values: unknown[] }> = [];
  const repository = createSetupReceiptRepository({
    listDocuments: async (_db: string, collection: string, encoded: string[]) => {
      assert.equal(collection, 'enrollment_receipts'); queries = encoded.map((value) => JSON.parse(value));
      return { total: 0, documents: [] };
    }, getDocument: async () => { throw new AppwriteException('missing', 404); },
  } as unknown as Databases);
  assert.deepEqual(await repository.committedReceipts('enrollment'), []);
  assert.ok(queries.some((query) => query.method === 'equal' && query.attribute === 'enrollment_token_id' && query.values[0] === 'enrollment'));
  assert.ok(queries.some((query) => query.method === 'limit' && query.values[0] === 2));
  assert.equal(await repository.heartbeatPending('device'), false);
  const ambiguous = createSetupReceiptRepository({ listDocuments: async () => ({ total: 2, documents: [{}, {}] }),
    getDocument: async () => { throw new Error('private'); } } as unknown as Databases);
  await assert.rejects(ambiguous.committedReceipts('enrollment'), /Setup unavailable/);
  await assert.rejects(ambiguous.heartbeatPending('device'), /Setup unavailable/);
});

test('operator audit requires a matching durable record and fails closed on uncertain writes', async () => {
  let current: Record<string, unknown> = {}; let corrupt = false;
  const repository = createAuditRepository({
    createDocument: async (_db: string, _collection: string, _id: string, data: Record<string, unknown>, permissions: unknown[]) => {
      assert.deepEqual(permissions, []); current = data;
    }, getDocument: async () => corrupt ? { ...current, actor_id: 'different' } : current,
  } as unknown as Databases);
  const event = { organizationId: 'org', actorId: 'operator', enrollmentId: 'enrollment', sourceIp: '127.0.0.1', action: 'enrollment.create' as const };
  await repository.recordOperator('audit', event);
  assert.equal(current.actor_type, 'technician'); assert.equal(current.metadata_json, '{"enrollmentId":"enrollment"}');
  corrupt = true; await assert.rejects(repository.recordOperator('audit', event), /Operator audit unavailable/);
  const uncertain = createAuditRepository({ createDocument: async () => { throw new Error('timeout'); } } as unknown as Databases);
  await assert.rejects(uncertain.recordOperator('audit', event), /Operator audit unavailable/);
});
