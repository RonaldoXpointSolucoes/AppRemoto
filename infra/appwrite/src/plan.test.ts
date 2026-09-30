import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REMOTE_MANAGEMENT_SCHEMA } from './schema.ts';
import { inspectSchema } from './inspect.ts';
import { buildProvisionPlan } from './plan.ts';
import { redactReport } from './redact.ts';
import type { AppwriteAttribute, AppwriteGateway } from './gateway.ts';
import type { RemoteManagementSchema } from './schema.ts';

const organizations = REMOTE_MANAGEMENT_SCHEMA.collections[0]!;

async function inspectSingleAttribute(collectionId: string, attribute: AppwriteAttribute, desired: RemoteManagementSchema = REMOTE_MANAGEMENT_SCHEMA) {
  const gateway: AppwriteGateway = {
    async listDatabases() { return [{ $id: desired.database.id, name: desired.database.name }]; },
    async listCollections() { return [{ $id: collectionId, name: collectionId, permissions: [], documentSecurity: false }]; },
    async listAttributes() { return [attribute]; },
    async listIndexes() { return []; },
  };
  return buildProvisionPlan(await inspectSchema(gateway, desired), desired).actions.find(
    (action) => action.id === `${collectionId}/${attribute.key}`);
}

test('empty project plans each desired resource for creation in dependency order', () => {
  const plan = buildProvisionPlan({ database: null, collections: [] });
  assert.deepEqual(plan.actions.slice(0, 6).map(({ resource, id, outcome }) => [resource, id, outcome]), [
    ['database', 'remote_management', 'create'],
    ['collection', 'organizations', 'create'],
    ['attribute', 'organizations/name', 'create'],
    ['attribute', 'organizations/slug', 'create'],
    ['attribute', 'organizations/active', 'create'],
    ['index', 'organizations/u_slug', 'create'],
  ]);
  assert.equal(plan.actions.every((action) => action.outcome === 'create'), true);
});

test('enum element order is immaterial but index attribute order is significant', () => {
  const sessions = REMOTE_MANAGEMENT_SCHEMA.collections.find((item) => item.id === 'connection_sessions')!;
  const members = REMOTE_MANAGEMENT_SCHEMA.collections.find((item) => item.id === 'organization_members')!;
  const plan = buildProvisionPlan({
    database: { id: 'remote_management', name: 'remote_management' },
    collections: [{ ...sessions, attributes: sessions.attributes.map((attribute) =>
      attribute.key === 'status' && attribute.type === 'enum'
        ? { ...attribute, elements: [...attribute.elements].reverse() } : attribute),
    }, { ...members, indexes: members.indexes.map((index) => index.id === 'u_organization_id_user_id'
      ? { ...index, attributes: [...index.attributes].reverse() } : index) }],
  }, REMOTE_MANAGEMENT_SCHEMA);
  assert.equal(plan.actions.find((action) => action.id === 'connection_sessions/status')?.outcome, 'unchanged');
  assert.deepEqual(plan.actions.find((action) => action.id === 'organization_members/u_organization_id_user_id'),
    { resource: 'index', id: 'organization_members/u_organization_id_user_id', outcome: 'conflict', reason: 'definition_mismatch' });
});

test('compatible partial inventory is unchanged where present and ignores unrelated resources', () => {
  const plan = buildProvisionPlan({
    database: { id: 'remote_management', name: 'remote_management' },
    collections: [{
      id: 'organizations', name: 'organizations', permissions: [], documentSecurity: false,
      attributes: [{ key: 'name', type: 'string', size: 128, required: true }], indexes: [],
    }, {
      id: 'unrelated', name: 'unrelated', permissions: [], documentSecurity: false,
      attributes: [], indexes: [],
    }],
  }, REMOTE_MANAGEMENT_SCHEMA);
  assert.deepEqual(plan.actions.slice(0, 6).map(({ outcome }) => outcome),
    ['unchanged', 'unchanged', 'unchanged', 'create', 'create', 'create']);
  assert.equal(plan.actions.some((action) => action.id.includes('unrelated')), false);
});

test('incompatible attribute produces a conflict without a replacement action', () => {
  const plan = buildProvisionPlan({
    database: { id: 'remote_management', name: 'remote_management' },
    collections: [{ ...organizations, attributes: [
      { key: 'name', type: 'string', size: 64, required: true },
      ...organizations.attributes.slice(1),
    ] }],
  }, REMOTE_MANAGEMENT_SCHEMA);
  assert.deepEqual(plan.actions.filter((action) => action.id === 'organizations/name'), [
    { resource: 'attribute', id: 'organizations/name', outcome: 'conflict', reason: 'definition_mismatch' },
  ]);
});

test('duplicate index signature under another ID conflicts; ordered index keys matter', () => {
  const membership = REMOTE_MANAGEMENT_SCHEMA.collections.find((item) => item.id === 'organization_members')!;
  const plan = buildProvisionPlan({
    database: { id: 'remote_management', name: 'remote_management' },
    collections: [{ ...membership, indexes: [
      { id: 'other_unique', type: 'unique', attributes: ['organization_id', 'user_id'] },
      { id: 'q_organization_id', type: 'key', attributes: ['user_id'] },
    ] }],
  }, REMOTE_MANAGEMENT_SCHEMA);
  assert.deepEqual(plan.actions.filter((action) => action.id.startsWith('organization_members/') && action.resource === 'index'), [
    { resource: 'index', id: 'organization_members/u_organization_id_user_id', outcome: 'conflict', reason: 'duplicate_definition' },
    { resource: 'index', id: 'organization_members/q_organization_id', outcome: 'conflict', reason: 'definition_mismatch' },
    { resource: 'index', id: 'organization_members/q_user_id', outcome: 'conflict', reason: 'duplicate_definition' },
  ]);
});

test('legacy index on the same ordered attributes conflicts even with different options', () => {
  const plan = buildProvisionPlan({
    database: { id: 'remote_management', name: 'remote_management' },
    collections: [{ ...organizations, indexes: [
      { id: 'legacy_slug', type: 'key', attributes: ['slug'], orders: ['DESC'] },
    ] }],
  });
  assert.deepEqual(plan.actions.find((action) => action.id === 'organizations/u_slug'),
    { resource: 'index', id: 'organizations/u_slug', outcome: 'conflict', reason: 'duplicate_definition' });
});

test('optional string with an existing default conflicts with the declared absence of a default', async () => {
  const action = await inspectSingleAttribute('devices', {
    key: 'agent_version', type: 'string', size: 64, required: false,
    array: false, default: 'legacy',
  });
  assert.deepEqual(action, {
    resource: 'attribute', id: 'devices/agent_version', outcome: 'conflict', reason: 'definition_mismatch',
  });
});

test('numeric bounds and string restrictions conflict when undeclared in the schema', async () => {
  const integer = await inspectSingleAttribute('device_credentials', {
    key: 'key_version', type: 'integer', required: true, min: 0, max: 10,
  });
  const encrypted = await inspectSingleAttribute('devices', {
    key: 'agent_version', type: 'string', size: 64, required: false, encrypt: true,
  });
  const formatted = await inspectSingleAttribute('devices', {
    key: 'agent_version', type: 'string', size: 64, required: false, format: 'email',
  });
  for (const action of [integer, encrypted, formatted]) {
    assert.equal(action?.outcome, 'conflict');
    assert.equal(action?.reason, 'definition_mismatch');
  }
});

test('null defaults and bounds, false flags, and intrinsic formats normalize to unchanged', async () => {
  const optional = await inspectSingleAttribute('devices', {
    key: 'agent_version', type: 'string', size: 64, required: false,
    default: null, array: false, encrypt: false, format: 'string',
  });
  const integer = await inspectSingleAttribute('device_credentials', {
    key: 'key_version', type: 'int', required: true, default: null, min: null, max: null, array: false,
  });
  assert.equal(optional?.outcome, 'unchanged');
  assert.equal(integer?.outcome, 'unchanged');
});

test('only exact Appwrite numeric sentinels normalize; real bounds still conflict', async () => {
  for (const type of ['integer', 'float'] as const) {
    const desired: RemoteManagementSchema = { database: REMOTE_MANAGEMENT_SCHEMA.database,
      collections: [{ ...organizations, attributes: [{ key: 'value', type, required: false }], indexes: [] }] };
    const sentinel = type === 'integer'
      ? JSON.parse('{"min":-9223372036854775808,"max":9223372036854775807}')
      : JSON.parse('{"min":-1.7976931348623157e+308,"max":1.7976931348623157e+308}');
    const cases = [
      { min: sentinel.min, max: sentinel.max, outcome: 'unchanged' },
      { min: sentinel.min, max: null, outcome: 'unchanged' },
      { min: null, max: sentinel.max, outcome: 'unchanged' },
      { min: 0, max: sentinel.max, outcome: 'conflict' },
      { min: sentinel.min, max: 100, outcome: 'conflict' },
      { min: -9007199254740991, max: 9007199254740991, outcome: 'conflict' },
      { min: -9223372036854774000, max: 9223372036854774000, outcome: 'conflict' },
      { min: sentinel.max, max: sentinel.max, outcome: 'conflict' },
      { min: sentinel.min, max: sentinel.min, outcome: 'conflict' },
    ];
    for (const { min, max, outcome } of cases) {
      const action = await inspectSingleAttribute('organizations', { key: 'value', type, required: false, min, max }, desired);
      assert.equal(action?.outcome, outcome, `${type}: ${min}..${max}`);
    }
    const bounded: RemoteManagementSchema = { ...desired, collections: [{ ...desired.collections[0]!,
      attributes: [{ key: 'value', type, required: false, min: 0, max: 100 }] }] };
    assert.equal((await inspectSingleAttribute('organizations', { key: 'value', type, required: false, ...sentinel }, bounded))?.outcome, 'conflict');
  }
});

test('declared default and float bounds require exact values after normalization', async () => {
  const devices = REMOTE_MANAGEMENT_SCHEMA.collections.find((item) => item.id === 'devices')!;
  const withDefault: RemoteManagementSchema = {
    ...REMOTE_MANAGEMENT_SCHEMA,
    collections: [{ ...devices, attributes: [
      { key: 'agent_version', type: 'string', size: 64, required: false, default: 'v1' },
    ], indexes: [] }],
  };
  const matchedDefault = await inspectSingleAttribute('devices', {
    key: 'agent_version', type: 'string', size: 64, required: false, default: 'v1',
  }, withDefault);
  const changedDefault = await inspectSingleAttribute('devices', {
    key: 'agent_version', type: 'string', size: 64, required: false, default: 'v2',
  }, withDefault);
  const withFloat: RemoteManagementSchema = {
    ...REMOTE_MANAGEMENT_SCHEMA,
    collections: [{ ...organizations, attributes: [
      { key: 'ratio', type: 'float', required: false, min: 0.5, max: 2.5, default: 1 },
    ], indexes: [] }],
  };
  const matchedFloat = await inspectSingleAttribute('organizations', {
    key: 'ratio', type: 'float', required: false, min: 0.5, max: 2.5, default: 1,
  }, withFloat);
  const changedFloat = await inspectSingleAttribute('organizations', {
    key: 'ratio', type: 'float', required: false, min: 0, max: 2.5, default: 1,
  }, withFloat);
  assert.equal(matchedDefault?.outcome, 'unchanged');
  assert.equal(changedDefault?.outcome, 'conflict');
  assert.equal(matchedFloat?.outcome, 'unchanged');
  assert.equal(changedFloat?.outcome, 'conflict');
});

test('inspect normalizes SDK aliases and unordered permissions and enum values', async () => {
  const gateway: AppwriteGateway = {
    async listDatabases() { return [{ $id: 'remote_management', name: 'remote_management' }]; },
    async listCollections() { return [{ $id: 'organizations', name: 'organizations', permissions: [], documentSecurity: false }]; },
    async listAttributes() { return [
      { key: 'name', type: 'string', size: 128, required: true },
      { key: 'slug', type: 'string', size: 64, required: true },
      { key: 'active', type: 'bool', required: true },
    ]; },
    async listIndexes() { return [{ key: 'u_slug', type: 'unique', attributes: ['slug'] }]; },
  };
  const actual = await inspectSchema(gateway, REMOTE_MANAGEMENT_SCHEMA);
  const plan = buildProvisionPlan(actual, REMOTE_MANAGEMENT_SCHEMA);
  assert.deepEqual(plan.actions.slice(0, 6).map(({ outcome }) => outcome),
    ['unchanged', 'unchanged', 'unchanged', 'unchanged', 'unchanged', 'unchanged']);
});

test('redacted report removes nested sensitive values while retaining resource IDs and outcomes', () => {
  const report = redactReport({
    resourceId: 'device_tokens/token_hash', outcome: 'conflict', stage: 'testing',
    key: 'raw-key', token: 'raw-token', nested: [{ password_ciphertext: 'cipher', nonce: 'n', tag: 't',
      credentialHash: 'digest', appwriteSecret: 'secret' }],
  });
  assert.deepEqual(report, {
    resourceId: 'device_tokens/token_hash', outcome: 'conflict', stage: 'testing',
    key: '[REDACTED]', token: '[REDACTED]', nested: [{ password_ciphertext: '[REDACTED]',
      nonce: '[REDACTED]', tag: '[REDACTED]', credentialHash: '[REDACTED]', appwriteSecret: '[REDACTED]' }],
  });
});
