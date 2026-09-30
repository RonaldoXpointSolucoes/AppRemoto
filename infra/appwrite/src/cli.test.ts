import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCli } from './cli.ts';
import { FakeGateway } from './testing/fake-gateway.ts';

const env = { APPWRITE_ENDPOINT: 'https://example.invalid/v1', APPWRITE_PROJECT_ID: 'default-6abc5640003cb361b809', APPWRITE_API_KEY: 'FAKE_SECRET_FOR_CLI' };

test('inspect and plan are read-only; CLI apply converges with fake gateway and redacted reports', async () => {
  const gateway = new FakeGateway();
  const persisted: unknown[] = [];
  const dependencies = { gatewayFactory: () => gateway, protect: async () => '.local/remote-platform/test.dpapi',
    persist: async (report: unknown) => { persisted.push(report); } };
  for (const mode of ['inspect', 'plan']) await runCli([mode], env, dependencies);
  assert.equal(gateway.writes, 0);
  assert.equal(persisted.length, 0);
  const first = await runCli(['apply'], env, dependencies);
  assert.equal(first.status, 'completed');
  const writes = gateway.writes;
  const second = await runCli(['apply'], env, dependencies);
  assert.equal(second.status, 'completed');
  assert.equal(gateway.writes, writes);
  assert.equal(persisted.length, 2);
  assert.equal(JSON.stringify(persisted).includes(gateway.receivedPassword), false);
  assert.equal(JSON.stringify(persisted).includes(env.APPWRITE_API_KEY), false);
});

test('CLI validates project and forbids secret argv before gateway construction', async () => {
  const dependencies = { gatewayFactory: () => { assert.fail('must not construct gateway'); },
    protect: async () => '', persist: async () => {} };
  for (const [args, environment] of [
    [['apply'], { ...env, APPWRITE_PROJECT_ID: 'wrong' }],
    [['apply', '--key', 'FAKE_ARGV_SECRET'], env],
  ] as const) {
    const result = await runCli([...args], environment, dependencies);
    assert.equal(result.status, 'failed');
    assert.equal(JSON.stringify(result).includes('FAKE_ARGV_SECRET'), false);
  }
});

test('apply conflict and attribute failure block administrator and redact failures', async () => {
  for (const state of ['conflict', 'stuck']) {
    const gateway = new FakeGateway();
    if (state === 'conflict') gateway.database = { $id: 'remote_management', name: 'wrong' };
    else gateway.attributeState = 'failed';
    const reports: unknown[] = [];
    const result = await runCli(['apply'], env, { gatewayFactory: () => gateway,
      protect: async () => { assert.fail('no admin on schema failure'); },
      persist: async (report: unknown) => { reports.push(report); } });
    assert.equal(result.status, 'failed');
    assert.equal(gateway.user, null);
    if (state === 'conflict') assert.equal(gateway.writes, 0);
    assert.equal(reports.length, 1);
  }
});
