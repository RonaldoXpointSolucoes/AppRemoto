import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppwriteAttribute, AppwriteCollection } from './gateway.ts';
import { applyProvisionPlan } from './apply.ts';
import { inspectSchema } from './inspect.ts';
import { migrateGlobalRole, runGlobalRoleMigrationCli } from './migrate-global-role.ts';
import { buildProvisionPlan } from './plan.ts';
import { REMOTE_MANAGEMENT_SCHEMA } from './schema.ts';
import { FakeGateway } from './testing/fake-gateway.ts';

const environment = { APPWRITE_ENDPOINT: 'https://appwrite.xpointsolucoes.com.br/v1',
  APPWRITE_PROJECT_ID: '6abc5640003cb361b809', APPWRITE_API_KEY: 'SYNTHETIC_TEST_KEY' };
const legacy: AppwriteAttribute = { key: 'global_role', type: 'enum', format: 'enum',
  elements: ['super_admin'], required: true, array: false, default: null };

function fixture(attribute: AppwriteAttribute | null = legacy) {
  let current = attribute;
  let writes = 0;
  let status = 'available';
  const events: string[] = [];
  const gateway = {
    projectId: environment.APPWRITE_PROJECT_ID,
    listDatabases: async () => { events.push('databases'); return [{ $id: 'remote_management', name: 'remote_management' }]; },
    listCollections: async (_database: string): Promise<AppwriteCollection[]> => { events.push('collections'); return [{ $id: 'technician_profiles',
      name: 'technician_profiles', permissions: [], documentSecurity: false }]; },
    listAttributes: async (_database: string, _collection: string): Promise<AppwriteAttribute[]> => {
      events.push('attributes'); return current ? [current] : [];
    },
    getAttributeStatus: async (_database: string, _collection: string, _key: string) => {
      events.push('status'); return status;
    },
    updateGlobalRoleEnum: async () => { events.push('update'); writes++; current = { ...current!, required: false }; },
  };
  return { gateway, events, get writes() { return writes; },
    set current(value: AppwriteAttribute | null) { current = value; },
    set status(value: string) { status = value; } };
}

test('legacy enum updates once, verifies desired state, and second run makes zero writes', async () => {
  const state = fixture();
  assert.deepEqual(await migrateGlobalRole(state.gateway), { outcome: 'updated' });
  assert.deepEqual(state.events, ['databases', 'collections', 'attributes', 'update', 'status',
    'databases', 'collections', 'attributes']);
  assert.equal(state.writes, 1);
  assert.deepEqual(await migrateGlobalRole(state.gateway), { outcome: 'unchanged' });
  assert.equal(state.writes, 1);
  assert.deepEqual(state.events.slice(-3), ['databases', 'collections', 'attributes']);
});

test('only the exact database, collection, and target enum states are accepted', async () => {
  const cases: { name: string; change: (state: ReturnType<typeof fixture>) => void }[] = [
    { name: 'missing database', change: (s) => { s.gateway.listDatabases = async () => []; } },
    { name: 'wrong database', change: (s) => { s.gateway.listDatabases = async () => [{ $id: 'other', name: 'other' }]; } },
    { name: 'wrong database name', change: (s) => { s.gateway.listDatabases = async () => [{ $id: 'remote_management', name: 'other' }]; } },
    { name: 'missing collection', change: (s) => { s.gateway.listCollections = async () => []; } },
    { name: 'wrong collection name', change: (s) => { s.gateway.listCollections = async () => [{ $id: 'technician_profiles', name: 'other', permissions: [], documentSecurity: false }]; } },
    { name: 'collection permissions', change: (s) => { s.gateway.listCollections = async () => [{ $id: 'technician_profiles', name: 'technician_profiles', permissions: ['any'], documentSecurity: false }]; } },
    { name: 'missing attribute', change: (s) => { s.current = null; } },
    { name: 'wrong key', change: (s) => { s.current = { ...legacy, key: 'other' }; } },
    { name: 'wrong type', change: (s) => { s.current = { ...legacy, type: 'string' }; } },
    { name: 'wrong format', change: (s) => { s.current = { ...legacy, format: 'other' }; } },
    { name: 'wrong enum', change: (s) => { s.current = { ...legacy, elements: ['super_admin', 'technician'] }; } },
    { name: 'wrong default', change: (s) => { s.current = { ...legacy, default: 'super_admin' }; } },
    { name: 'missing default', change: (s) => { const { default: _unused, ...attribute } = legacy; s.current = attribute; } },
    { name: 'array', change: (s) => { s.current = { ...legacy, array: true }; } },
    { name: 'invalid required', change: (s) => { s.current = { ...legacy, required: 'false' as unknown as boolean }; } },
    { name: 'duplicate target attribute', change: (s) => { s.gateway.listAttributes = async () => [legacy, legacy]; } },
  ];
  for (const item of cases) {
    const state = fixture();
    item.change(state);
    await assert.rejects(migrateGlobalRole(state.gateway), /Global role migration failed/, item.name);
    assert.equal(state.writes, 0, item.name);
  }
});

test('wrong project fails before any inventory read or write', async () => {
  const state = fixture();
  state.gateway.projectId = 'wrong';
  await assert.rejects(migrateGlobalRole(state.gateway), /Global role migration failed/);
  assert.deepEqual(state.events, []);
});

test('invalid wait options fail before the legacy attribute can be updated', async () => {
  const state = fixture();
  await assert.rejects(migrateGlobalRole(state.gateway, { attempts: 0 }), /Global role migration failed/);
  assert.equal(state.writes, 0);
});

test('generic provisioner keeps the legacy enum as a conflict with zero writes', async () => {
  const gateway = new FakeGateway();
  gateway.database = { $id: 'remote_management', name: 'remote_management' };
  gateway.collections.set('technician_profiles', REMOTE_MANAGEMENT_SCHEMA.collections.find(
    (item) => item.id === 'technician_profiles')!);
  gateway.attributes.set('technician_profiles', [{ key: 'global_role', type: 'enum',
    elements: ['super_admin'], required: true, array: false, default: null, format: 'enum' }]);
  const plan = buildProvisionPlan(await inspectSchema(gateway));
  assert.deepEqual(plan.actions.find((action) => action.id === 'technician_profiles/global_role'),
    { resource: 'attribute', id: 'technician_profiles/global_role', outcome: 'conflict', reason: 'definition_mismatch' });
  await assert.rejects(applyProvisionPlan(gateway, plan));
  assert.equal(gateway.writes, 0);
});

test('update failure, timeout, and post-update mismatch return only a generic error', async () => {
  const privatePayload = 'SYNTHETIC_PRIVATE_SDK_PAYLOAD';
  const failure = fixture();
  failure.gateway.updateGlobalRoleEnum = async () => { throw new Error(privatePayload); };
  const timeout = fixture();
  timeout.status = 'processing';
  const mismatch = fixture();
  mismatch.gateway.updateGlobalRoleEnum = async () => { mismatch.current = { ...legacy, required: false, elements: ['wrong'] }; };
  for (const state of [failure, timeout, mismatch]) {
    await assert.rejects(migrateGlobalRole(state.gateway, { attempts: 2, delayMs: 0 }), (error: Error) => {
      assert.equal(String(error), 'Error: Global role migration failed; inspect the target before retrying');
      assert.equal(JSON.stringify(error).includes(privatePayload), false);
      return true;
    });
  }
  assert.equal(timeout.writes, 1);
  assert.deepEqual(timeout.events.filter((event) => event === 'status'), ['status', 'status']);
});

test('CLI rejects argv and unsafe environment and persists only safe results', async () => {
  const state = fixture();
  const persisted: unknown[] = [];
  const dependencies = { gatewayFactory: () => state.gateway,
    persist: async (report: unknown) => { persisted.push(report); } };
  assert.deepEqual(await runGlobalRoleMigrationCli([], environment, dependencies),
    { mode: 'migrate-global-role', status: 'completed', outcome: 'updated' });
  assert.deepEqual(persisted, [{ mode: 'migrate-global-role', status: 'completed', outcome: 'updated' }]);
  const invalid = await runGlobalRoleMigrationCli(['--key', 'SYNTHETIC_ARGV_SECRET'], environment, dependencies);
  assert.equal(invalid.status, 'failed');
  assert.equal(state.writes, 1);
  assert.equal(JSON.stringify({ invalid, persisted }).includes('SYNTHETIC_ARGV_SECRET'), false);
  assert.equal(JSON.stringify({ invalid, persisted }).includes(environment.APPWRITE_API_KEY), false);
  const rejected = await runGlobalRoleMigrationCli([], { ...environment, APPWRITE_PROJECT_ID: 'wrong' },
    { gatewayFactory: () => { assert.fail('must not construct'); }, persist: async () => {} });
  assert.equal(rejected.status, 'failed');
});

test('CLI returns and persists a generic report when the gateway exposes a private payload', async () => {
  const state = fixture();
  state.gateway.listAttributes = async () => { throw new Error('SYNTHETIC_PRIVATE_SDK_PAYLOAD'); };
  const persisted: unknown[] = [];
  const report = await runGlobalRoleMigrationCli([], environment, { gatewayFactory: () => state.gateway,
    persist: async (value: unknown) => { persisted.push(value); } });
  const expected = { mode: 'migrate-global-role', status: 'failed',
    error: 'Global role migration failed; inspect the target before retrying' };
  assert.deepEqual(report, expected);
  assert.deepEqual(persisted, [expected]);
  assert.equal(JSON.stringify({ report, persisted }).includes('SYNTHETIC_PRIVATE_SDK_PAYLOAD'), false);
  assert.equal(state.writes, 0);
});
