import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyProvisionPlan } from './apply.ts';
import { inspectSchema } from './inspect.ts';
import { buildProvisionPlan } from './plan.ts';
import { REMOTE_MANAGEMENT_SCHEMA } from './schema.ts';
import { FakeGateway, desiredResourceCount } from './testing/fake-gateway.ts';

const planFor = async (gateway: FakeGateway) => buildProvisionPlan(await inspectSchema(gateway));

function priorNinetyResourceGateway(): FakeGateway {
  const gateway = new FakeGateway();
  gateway.database = { $id: 'remote_management', name: 'remote_management' };
  for (const collection of REMOTE_MANAGEMENT_SCHEMA.collections.filter((item) => item.id !== 'enrollment_receipts')) {
    gateway.collections.set(collection.id, collection);
    gateway.attributes.set(collection.id, [...collection.attributes]);
    gateway.indexes.set(collection.id, [...collection.indexes]);
  }
  return gateway;
}

function currentOneHundredOneResourceGateway(): FakeGateway {
  const gateway = new FakeGateway();
  gateway.database = { $id: 'remote_management', name: 'remote_management' };
  for (const collection of REMOTE_MANAGEMENT_SCHEMA.collections) {
    gateway.collections.set(collection.id, collection);
    gateway.attributes.set(collection.id, collection.attributes.filter((attribute) =>
      collection.id !== 'enrollment_receipts' || !['expected_use_count', 'recovery_frozen'].includes(attribute.key)));
    gateway.indexes.set(collection.id, [...collection.indexes]);
  }
  return gateway;
}

test('prior 101-resource inventory plans two receipt attribute creates and fake apply converges', async () => {
  const gateway = currentOneHundredOneResourceGateway();
  const first = await planFor(gateway);
  assert.equal(first.actions.length, 103);
  assert.equal(first.actions.filter((action) => action.outcome === 'unchanged').length, 101);
  assert.deepEqual(first.actions.filter((action) => action.outcome === 'create').map(({ resource, id }) => [resource, id]), [
    ['attribute', 'enrollment_receipts/expected_use_count'],
    ['attribute', 'enrollment_receipts/recovery_frozen'],
  ]);
  assert.deepEqual(first.actions.filter((action) => action.outcome === 'conflict'), []);
  await applyProvisionPlan(gateway, first);
  assert.equal(gateway.writes, 2);
  const second = await planFor(gateway);
  assert.equal(second.actions.length, 103);
  assert.equal(second.actions.every((action) => action.outcome === 'unchanged'), true);
  await applyProvisionPlan(gateway, second);
  assert.equal(gateway.writes, 2);
});

test('current 102-resource inventory plans only required recovery provenance and converges after one write', async () => {
  const gateway = currentOneHundredOneResourceGateway();
  gateway.attributes.get('enrollment_receipts')!.push({ key: 'expected_use_count', type: 'integer', required: true });
  const first = await planFor(gateway);
  assert.equal(first.actions.length, 103);
  assert.equal(first.actions.filter((action) => action.outcome === 'unchanged').length, 102);
  assert.deepEqual(first.actions.filter((action) => action.outcome === 'create').map(({ resource, id }) => [resource, id]), [
    ['attribute', 'enrollment_receipts/recovery_frozen'],
  ]);
  assert.deepEqual(first.actions.filter((action) => action.outcome === 'conflict'), []);
  await applyProvisionPlan(gateway, first); assert.equal(gateway.writes, 1);
  const second = await planFor(gateway); assert.equal(second.actions.length, 103);
  assert.equal(second.actions.every((action) => action.outcome === 'unchanged'), true);
  await applyProvisionPlan(gateway, second); assert.equal(gateway.writes, 1);
});

test('incompatible recovery provenance blocks generic apply without writes', async () => {
  const gateway = currentOneHundredOneResourceGateway();
  gateway.attributes.get('enrollment_receipts')!.push({ key: 'recovery_frozen', type: 'boolean', required: false });
  const plan = await planFor(gateway);
  assert.deepEqual(plan.actions.filter((action) => action.outcome === 'conflict'), [
    { resource: 'attribute', id: 'enrollment_receipts/recovery_frozen', outcome: 'conflict', reason: 'definition_mismatch' },
  ]);
  await assert.rejects(applyProvisionPlan(gateway, plan), /conflict/i); assert.equal(gateway.writes, 0);
});

test('incompatible expected use count blocks the whole apply without writes', async () => {
  const gateway = currentOneHundredOneResourceGateway();
  gateway.attributes.set('enrollment_receipts', [
    ...gateway.attributes.get('enrollment_receipts')!,
    { key: 'expected_use_count', type: 'string', size: 16, required: true },
  ]);
  const plan = await planFor(gateway);
  assert.deepEqual(plan.actions.filter((action) => action.outcome === 'conflict'), [
    { resource: 'attribute', id: 'enrollment_receipts/expected_use_count', outcome: 'conflict', reason: 'definition_mismatch' },
  ]);
  await assert.rejects(applyProvisionPlan(gateway, plan), /conflict/i);
  assert.equal(gateway.writes, 0);
});

test('prior 90-resource inventory plans only 13 receipt creates and fake apply converges', async () => {
  const gateway = priorNinetyResourceGateway();
  const first = await planFor(gateway);
  assert.equal(first.actions.length, 103);
  assert.equal(first.actions.filter((action) => action.outcome === 'unchanged').length, 90);
  assert.deepEqual(first.actions.filter((action) => action.outcome === 'create').map(({ resource, id }) => [resource, id]), [
    ['collection', 'enrollment_receipts'],
    ['attribute', 'enrollment_receipts/organization_id'],
    ['attribute', 'enrollment_receipts/enrollment_token_id'],
    ['attribute', 'enrollment_receipts/device_id'],
    ['attribute', 'enrollment_receipts/device_uuid'],
    ['attribute', 'enrollment_receipts/status'],
    ['attribute', 'enrollment_receipts/token_use_consumed'],
    ['attribute', 'enrollment_receipts/expected_use_count'],
    ['attribute', 'enrollment_receipts/recovery_frozen'],
    ['index', 'enrollment_receipts/u_enrollment_token_id_device_uuid'],
    ['index', 'enrollment_receipts/q_organization_id'],
    ['index', 'enrollment_receipts/q_device_id'],
    ['index', 'enrollment_receipts/q_status'],
  ]);
  await applyProvisionPlan(gateway, first);
  assert.equal(gateway.writes, 13);
  const second = await planFor(gateway);
  assert.equal(second.actions.length, 103);
  assert.equal(second.actions.every((action) => action.outcome === 'unchanged'), true);
  await applyProvisionPlan(gateway, second);
  assert.equal(gateway.writes, 13);
});

test('incompatible preexisting receipt field blocks the whole generic apply', async () => {
  const gateway = priorNinetyResourceGateway();
  gateway.collections.set('enrollment_receipts', { id: 'enrollment_receipts', name: 'enrollment_receipts',
    permissions: [], documentSecurity: false, attributes: [], indexes: [] });
  gateway.attributes.set('enrollment_receipts', [{ key: 'status', type: 'enum', required: true,
    elements: ['pending', 'committed', 'failed'] }]);
  const plan = await planFor(gateway);
  assert.deepEqual(plan.actions.filter((action) => action.outcome === 'conflict'), [
    { resource: 'attribute', id: 'enrollment_receipts/status', outcome: 'conflict', reason: 'definition_mismatch' },
  ]);
  await assert.rejects(applyProvisionPlan(gateway, plan), /conflict/i);
  assert.equal(gateway.writes, 0);
});

test('apply creates in dependency order and observes attributes before indexes', async () => {
  const gateway = new FakeGateway();
  await applyProvisionPlan(gateway, await planFor(gateway));
  assert.equal(gateway.writes, desiredResourceCount);
  const positions = ['database', 'collection', 'attribute', 'attribute-ready', 'index', 'index-ready'];
  for (let index = 1; index < positions.length; index++) {
    assert.ok(gateway.events.lastIndexOf(positions[index - 1]!) < gateway.events.indexOf(positions[index]!));
  }
  assert.equal((await planFor(gateway)).actions.every((action) => action.outcome === 'unchanged'), true);
});

test('any conflict or wrong project blocks all writes', async () => {
  const conflict = new FakeGateway();
  const plan = await planFor(conflict);
  await assert.rejects(applyProvisionPlan(conflict, { actions: [...plan.actions,
    { resource: 'index', id: 'late/conflict', outcome: 'conflict' }] }), /conflict/i);
  assert.equal(conflict.writes, 0);
  const wrong = new FakeGateway();
  Object.defineProperty(wrong, 'projectId', { value: 'another-project' });
  await assert.rejects(applyProvisionPlan(wrong, await planFor(wrong)), /project/i);
  assert.equal(wrong.writes, 0);
});

test('apply accepts the exact production project ID and rejects the route-prefixed or unrelated ID before writes', async () => {
  const approved = new FakeGateway();
  Object.defineProperty(approved, 'projectId', { value: '6abc5640003cb361b809' });
  await applyProvisionPlan(approved, await planFor(approved));
  assert.equal(approved.writes, desiredResourceCount);

  for (const projectId of ['default-6abc5640003cb361b809', 'another-project']) {
    const gateway = new FakeGateway();
    Object.defineProperty(gateway, 'projectId', { value: projectId });
    await assert.rejects(applyProvisionPlan(gateway, await planFor(gateway)), /project/i);
    assert.equal(gateway.writes, 0);
  }
});

test('fresh inspection catches a conflicting change after planning before any write', async () => {
  const gateway = new FakeGateway();
  const stale = await planFor(gateway);
  gateway.database = { $id: 'remote_management', name: 'incompatible' };
  await assert.rejects(applyProvisionPlan(gateway, stale), /conflict/i);
  assert.equal(gateway.writes, 0);
});

test('interrupted apply converges after inspect and plan without duplicate creates', async () => {
  const gateway = new FakeGateway();
  gateway.interruptAt = 15;
  await assert.rejects(applyProvisionPlan(gateway, await planFor(gateway)));
  gateway.interruptAt = Infinity;
  await applyProvisionPlan(gateway, await planFor(gateway));
  assert.equal(gateway.writes, desiredResourceCount);
  await applyProvisionPlan(gateway, await planFor(gateway));
  assert.equal(gateway.writes, desiredResourceCount);
});

test('unavailable attributes prevent dependent indexes and bounded waits time out', async () => {
  const gateway = new FakeGateway();
  gateway.attributeState = 'processing';
  await assert.rejects(applyProvisionPlan(gateway, await planFor(gateway), { attempts: 2, delayMs: 0 }), /ready/i);
  assert.equal(gateway.events.includes('index'), false);
});

test('gateway errors cannot expose their payload through apply exceptions', async () => {
  const gateway = new FakeGateway();
  gateway.failure = new Error('FAKE_API_SECRET_DO_NOT_ECHO');
  await assert.rejects(applyProvisionPlan(gateway, await planFor(gateway)), (error: Error) => {
    assert.doesNotMatch(String(error) + JSON.stringify(error), /FAKE_API_SECRET_DO_NOT_ECHO/);
    return true;
  });
});
