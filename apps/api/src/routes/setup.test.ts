import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../app.ts';
import { Writable } from 'node:stream';
import type { TechnicianServices } from '../plugins/technician-auth.ts';

function services(): TechnicianServices {
  return { projectId: 'test', jwtVerifier: { verify: async () => ({ userId: 'operator' }) },
    technicians: { findByUserId: async () => ({ userId: 'operator', displayName: 'Operator', globalRole: 'super_admin', active: true }),
      listMemberships: async () => [] }, organizations: { listActive: async () => [{ id: 'org', name: 'Org', slug: 'org', active: true }] },
    operatorSetup: { create: async () => ({ enrollmentId: 'enrollment', enrollmentToken: 'a'.repeat(43), expiresAt: '2026-10-01T12:30:00Z' }),
      status: async () => ({ status: 'waiting', expiresAt: '2026-10-01T12:30:00Z', device: null }),
      connect: async () => { throw new Error('synthetic private detail'); } } };
}

test('operator endpoints exist and require authentication with no-store', async () => {
  const app = buildApp({ logger: false }, {
    projectId: 'test', jwtVerifier: { verify: async () => null },
    technicians: { findByUserId: async () => null, listMemberships: async () => [] },
    organizations: { listActive: async () => [] },
    operatorSetup: {} as never,
  });
  try {
    for (const [method, url] of [['POST', '/v1/enrollment-tokens'], ['GET', '/v1/enrollment-tokens/test/status'],
      ['POST', '/v1/devices/test/connect']] as const) {
      const response = await app.inject({ method, url });
      assert.equal(response.statusCode, 401);
      assert.equal(response.headers['cache-control'], 'no-store');
    }
  } finally { await app.close(); }
});

test('setup routes validate fields and never include provisioning secrets or query values in logs', async () => {
  const lines: string[] = [];
  const stream = new Writable({ write(chunk, _encoding, callback) { lines.push(chunk.toString()); callback(); } });
  const app = buildApp({ logger: { stream } }, services());
  const headers = { authorization: 'Bearer synthetic.jwt.value' };
  try {
    const result = await app.inject({ method: 'POST', url: '/v1/enrollment-tokens', headers,
      payload: { organizationId: 'org', deviceDisplayName: 'PC' } });
    assert.equal(result.statusCode, 201); assert.equal(result.headers['cache-control'], 'no-store');
    for (const input of [
      { method: 'POST' as const, url: '/v1/enrollment-tokens', payload: { organizationId: 'org', deviceDisplayName: 'PC', surprise: true } },
      { method: 'GET' as const, url: '/v1/enrollment-tokens/enrollment/status?token=synthetic-query-secret' },
      { method: 'POST' as const, url: '/v1/devices/device/connect', payload: { password: 'synthetic-body-secret' } },
    ]) {
      const response = await app.inject({ ...input, headers });
      assert.equal(response.statusCode, 400); assert.equal(response.headers['cache-control'], 'no-store');
    }
    const failed = await app.inject({ method: 'POST', url: '/v1/devices/device/connect', headers });
    assert.equal(failed.statusCode, 503); assert.equal(failed.headers['cache-control'], 'no-store');
    assert.ok(!failed.body.includes('synthetic private detail'));
    const logs = lines.join('');
    for (const secret of ['a'.repeat(43), 'synthetic.jwt.value', 'synthetic-query-secret', 'synthetic-body-secret', 'synthetic private detail']) {
      assert.ok(!logs.includes(secret));
    }
  } finally { await app.close(); }
});

test('privileged connect response is no-store and its transient URI never reaches request logs', async () => {
  const dependencies = services();
  const launchUri = 'rustdesk://connect/123456789@179.199.142.157:21116?key=synthetic&password=synthetic-launch-secret';
  dependencies.operatorSetup!.connect = async () => ({ launchUri });
  const lines: string[] = [];
  const stream = new Writable({ write(chunk, _encoding, callback) { lines.push(chunk.toString()); callback(); } });
  const app = buildApp({ logger: { stream } }, dependencies);
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/devices/device/connect',
      headers: { authorization: 'Bearer synthetic.jwt.value' }, payload: {} });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.json(), { launchUri });
    assert.ok(!lines.join('').includes('synthetic-launch-secret'));
    assert.ok(!lines.join('').includes('rustdesk://'));
  } finally { await app.close(); }
});
