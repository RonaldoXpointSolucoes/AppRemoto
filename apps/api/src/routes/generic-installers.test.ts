import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../app.ts';
import type { TechnicianServices } from '../plugins/technician-auth.ts';
import type { GenericInstallerService } from '../services/generic-installers.ts';

function services(): TechnicianServices {
  return { projectId: 'test', jwtVerifier: { verify: async () => ({ userId: 'operator' }) },
    technicians: { findByUserId: async () => ({ userId: 'operator', displayName: 'Operator', globalRole: 'super_admin', active: true }),
      listMemberships: async () => [] }, organizations: { listActive: async () => [] }, genericInstallers: {
      list: async () => ({ installers: [] }), create: async () => { throw new Error('synthetic-private-storage'); },
      download: async () => ({ package: { schemaVersion: 2, installerId: 'profile', installerToken: 'a'.repeat(43) } }),
      revoke: async () => ({ revoked: true }), enrollmentPassword: async () => undefined,
      prepare: async () => ({ schemaVersion: 1, enrollmentId: 'prepared', enrollmentToken: 'b'.repeat(43),
        expiresAt: '2026-10-02T02:00:00Z', organizationId: 'org', organizationName: 'Customer', deviceDisplayName: 'PC' }),
    } satisfies GenericInstallerService };
}
test('generic administrative routes require JWT and no-store, while prepare accepts only a distinct bootstrap bearer', async () => {
  const app = buildApp({ logger: false }, services());
  try {
    for (const [method, url] of [['GET', '/v1/generic-installers'], ['POST', '/v1/generic-installers'],
      ['POST', '/v1/generic-installers/profile/package'], ['POST', '/v1/generic-installers/profile/revoke']] as const) {
      const response = await app.inject({ method, url }); assert.equal(response.statusCode, 401);
      assert.equal(response.headers['cache-control'], 'no-store');
    }
    const payload = { installerId: 'profile', requestId: randomUUID(), requestSecret: 's'.repeat(43), companyName: 'Customer', deviceDisplayName: 'PC' };
    assert.equal((await app.inject({ method: 'POST', url: '/v1/agent/prepare-installation', payload,
      headers: { authorization: 'Bearer synthetic.jwt.value' } })).statusCode, 403);
    const prepared = await app.inject({ method: 'POST', url: '/v1/agent/prepare-installation', payload,
      headers: { authorization: `Bearer ${'a'.repeat(43)}` } });
    assert.equal(prepared.statusCode, 200); assert.equal(prepared.json().schemaVersion, 1);
    assert.equal(prepared.headers['cache-control'], 'no-store');
    for (const change of [{ password: 'private' }, { organizationId: 'unchecked' }, { requestSecret: '' }]) {
      assert.equal((await app.inject({ method: 'POST', url: '/v1/agent/prepare-installation', payload: { ...payload, ...change },
        headers: { authorization: `Bearer ${'a'.repeat(43)}` } })).statusCode, 400);
    }
  } finally { await app.close(); }
});

test('generic package/prepare requests omit all capabilities, request proofs, passwords and private errors from logs', async () => {
  const lines: string[] = [];
  const stream = new Writable({ write(chunk, _encoding, callback) { lines.push(chunk.toString()); callback(); } });
  const app = buildApp({ logger: { stream } }, services()); const headers = { authorization: 'Bearer synthetic.jwt.value' };
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/v1/generic-installers/profile/package', headers, payload: {} })).statusCode, 200);
    const failed = await app.inject({ method: 'POST', url: '/v1/generic-installers', headers, payload: { name: 'Package' } });
    assert.equal(failed.statusCode, 503); assert.ok(!failed.body.includes('synthetic-private-storage'));
    await app.inject({ method: 'POST', url: '/v1/agent/prepare-installation?password=synthetic-query-secret',
      headers: { authorization: `Bearer ${'a'.repeat(43)}` }, payload: { installerId: 'profile', requestId: randomUUID(),
        requestSecret: 's'.repeat(43), companyName: 'Customer', deviceDisplayName: 'PC' } });
    for (const secret of ['synthetic.jwt.value', 'a'.repeat(43), 's'.repeat(43), 'b'.repeat(43), 'synthetic-private-storage', 'synthetic-query-secret']) {
      assert.ok(!lines.join('').includes(secret));
    }
  } finally { await app.close(); }
});
