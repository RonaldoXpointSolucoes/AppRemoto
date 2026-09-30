import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyProvisionPlan } from './apply.ts';
import { inspectSchema } from './inspect.ts';
import { buildProvisionPlan } from './plan.ts';
import { FakeGateway, desiredResourceCount } from './testing/fake-gateway.ts';

const planFor = async (gateway: FakeGateway) => buildProvisionPlan(await inspectSchema(gateway));

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
