import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runCli } from './cli.ts';
import { FakeGateway } from './testing/fake-gateway.ts';
import { redactReport } from './redact.ts';

const env = { APPWRITE_ENDPOINT: 'https://appwrite.xpointsolucoes.com.br/v1', APPWRITE_PROJECT_ID: '6abc5640003cb361b809', APPWRITE_API_KEY: 'FAKE_SECRET_FOR_CLI' };

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
    [['apply'], { ...env, APPWRITE_PROJECT_ID: 'default-6abc5640003cb361b809' }],
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

test('apply reports only planner conflict fields in return value and persisted report', async () => {
  const gateway = new FakeGateway();
  gateway.database = { $id: 'remote_management', name: 'SYNTHETIC_PRIVATE_ACTUAL' };
  const reportPath = join(tmpdir(), `appremoto-conflict-${randomUUID()}.json`);
  try {
    const result = await runCli(['apply'], env, { gatewayFactory: () => gateway,
      protect: async () => { assert.fail('no admin on conflict'); },
      persist: async (report: unknown) => { await writeFile(reportPath, JSON.stringify(report)); } });
    const persisted = JSON.parse(await readFile(reportPath, 'utf8'));
    const expected = { mode: 'apply', status: 'failed',
      error: 'Provisioning command failed; verify configuration and inspect the target before retrying',
      result: { conflicts: [{ resource: 'database', id: 'remote_management', outcome: 'conflict', reason: 'definition_mismatch' }] } };
    assert.deepEqual(result, expected);
    assert.deepEqual(persisted, expected);
    assert.equal(gateway.writes, 0);
    assert.doesNotMatch(JSON.stringify({ result, persisted }), /SYNTHETIC_PRIVATE_ACTUAL|FAKE_SECRET_FOR_CLI|actual|desired|headers|stack/);
  } finally { await unlink(reportPath); }
});

test('raw gateway failure remains generic in return value and persisted report', async () => {
  const gateway = new FakeGateway();
  gateway.failure = Object.assign(new Error('SYNTHETIC_PRIVATE_RUNTIME'), {
    headers: { authorization: 'SYNTHETIC_PRIVATE_HEADER' },
    actual: 'SYNTHETIC_PRIVATE_ACTUAL', desired: 'SYNTHETIC_PRIVATE_DESIRED',
  });
  const persisted: unknown[] = [];
  const result = await runCli(['apply'], env, { gatewayFactory: () => gateway,
    protect: async () => { assert.fail('no admin on gateway failure'); },
    persist: async (report: unknown) => { persisted.push(report); } });
  const expected = { mode: 'apply', status: 'failed',
    error: 'Provisioning command failed; verify configuration and inspect the target before retrying' };
  assert.deepEqual(result, expected);
  assert.deepEqual(persisted, [expected]);
  assert.doesNotMatch(JSON.stringify({ result, persisted }), /SYNTHETIC_PRIVATE|FAKE_SECRET_FOR_CLI|actual|desired|headers|stack/);
});

test('inspect exposes attribute IDs while values and generic credentials stay redacted', async () => {
  const gateway = new FakeGateway();
  gateway.database = { $id: 'remote_management', name: 'remote_management' };
  gateway.collections.set('device_credentials', { id: 'device_credentials', name: 'device_credentials',
    permissions: [], documentSecurity: false, attributes: [], indexes: [] });
  gateway.attributes.set('device_credentials', [{ key: 'password_ciphertext', type: 'string', required: false,
    size: 4096, default: 'SYNTHETIC_PRIVATE_DEFAULT' }, { key: 'key_version', type: 'integer', required: true }]);
  const report = await runCli(['inspect'], env, { gatewayFactory: () => gateway,
    protect: async () => { assert.fail('read-only'); }, persist: async () => { assert.fail('read-only'); } });
  const inventory = report.result as { collections: { attributes: { attributeId: string; default?: unknown }[] }[] };
  assert.deepEqual(inventory.collections[0]!.attributes.map((attribute) => attribute.attributeId), ['password_ciphertext', 'key_version']);
  assert.equal(JSON.stringify(report).includes('SYNTHETIC_PRIVATE_DEFAULT'), false);
  const redacted = redactReport({ key: 'SYNTHETIC_API_KEY', apiKey: 'SYNTHETIC_API_KEY', token: 'SYNTHETIC_TOKEN',
    password: 'SYNTHETIC_PASSWORD', secret: 'SYNTHETIC_SECRET', hash: 'SYNTHETIC_HASH', ciphertext: 'SYNTHETIC_CIPHERTEXT',
    nonce: 'SYNTHETIC_NONCE', tag: 'SYNTHETIC_TAG' });
  assert.equal(JSON.stringify(redacted).includes('SYNTHETIC'), false);
});
