import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildApp } from '../app.ts';
import type { TechnicianServices } from '../plugins/technician-auth.ts';

const organizations = [
  { id: 'org-active', name: 'Active', slug: 'active', active: true, internal: 'hidden' },
  { id: 'org-other', name: 'Other', slug: 'other', active: true, internal: 'hidden' },
  { id: 'org-disabled', name: 'Disabled', slug: 'disabled', active: false, internal: 'hidden' },
];

function services(overrides: Partial<TechnicianServices> = {}): TechnicianServices {
  return {
    projectId: 'test-project',
    jwtVerifier: { verify: async (jwt) => jwt === 'valid.jwt.value' ? { userId: 'user-1' } : null },
    technicians: {
      findByUserId: async () => ({ userId: 'user-1', displayName: 'Technician', globalRole: 'super_admin', active: true }),
      listMemberships: async () => [],
    },
    organizations: { listActive: async () => organizations },
    ...overrides,
  };
}

async function request(path: string, dependencies: TechnicianServices, headers: Record<string, string | string[]> = {}) {
  const app = buildApp({ logger: false }, dependencies);
  try { return await app.inject({ method: 'GET', url: path, headers }); }
  finally { await app.close(); }
}

test('super admin sees only active organizations with safe projections', async () => {
  const headers = { authorization: 'Bearer valid.jwt.value' };
  const me = await request('/v1/me', services(), headers);
  const list = await request('/v1/organizations', services(), headers);
  assert.equal(me.statusCode, 200);
  assert.deepEqual(me.json(), { id: 'user-1', displayName: 'Technician', globalRole: 'super_admin', authorization: [
    { organizationId: 'org-active', role: 'super_admin', canView: true, canConnect: true, canManageDevices: true },
    { organizationId: 'org-other', role: 'super_admin', canView: true, canConnect: true, canManageDevices: true },
  ] });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json(), { organizations: [
    { id: 'org-active', name: 'Active', slug: 'active' }, { id: 'org-other', name: 'Other', slug: 'other' },
  ] });
});

test('Web SDK JWT reaches the technician routes as a Bearer token', async () => {
  const response = await request('/v1/me', services(), { authorization: 'Bearer valid.jwt.value' });
  assert.equal(response.statusCode, 200);
});

test('malformed, repeated, and mixed technician credentials are rejected', async () => {
  const invalidHeaders: Record<string, string | string[]>[] = [
    { authorization: '' },
    { authorization: 'Bearer' },
    { authorization: 'Basic valid.jwt.value' },
    { authorization: 'Bearer valid.jwt.value, Bearer valid.jwt.value' },
    { authorization: ['Bearer valid.jwt.value', 'Bearer valid.jwt.value'] },
    { authorization: 'Bearer valid.jwt.value', 'x-appwrite-session': 'legacy-secret' },
    { authorization: 'Bearer valid.jwt.value', cookie: 'a_session_test-project=legacy-secret' },
  ];
  for (const headers of invalidHeaders) {
    const response = await request('/v1/me', services(), headers);
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
  }
});

test('member sees only active can_view memberships', async () => {
  const dependencies = services({ technicians: {
    findByUserId: async () => ({ userId: 'user-1', displayName: 'Member', active: true }),
    listMemberships: async () => [
      { organizationId: 'org-active', userId: 'user-1', role: 'operator', canView: true, canConnect: false, canManageDevices: false },
      { organizationId: 'org-other', userId: 'user-1', role: 'operator', canView: false, canConnect: true, canManageDevices: true },
      { organizationId: 'org-disabled', userId: 'user-1', role: 'operator', canView: true, canConnect: true, canManageDevices: true },
      { organizationId: 'org-other', userId: 'different-user', role: 'operator', canView: true, canConnect: true, canManageDevices: true },
    ],
  } });
  const headers = { authorization: 'Bearer valid.jwt.value' };
  const me = await request('/v1/me', dependencies, headers);
  const list = await request('/v1/organizations', dependencies, headers);
  assert.equal(me.statusCode, 200);
  assert.deepEqual(me.json(), { id: 'user-1', displayName: 'Member', globalRole: null, authorization: [
    { organizationId: 'org-active', role: 'operator', canView: true, canConnect: false, canManageDevices: false },
  ] });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json(), { organizations: [{ id: 'org-active', name: 'Active', slug: 'active' }] });
});

test('expired JWT has a generic stable authentication error', async () => {
  const response = await request('/v1/me', services(), { authorization: 'Bearer expired.jwt.value' });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
  assert.ok(!response.body.includes('expired.jwt.value'));
});

test('disabled profile has a generic stable authorization error', async () => {
  const dependencies = services({ technicians: {
    findByUserId: async () => ({ userId: 'user-1', displayName: 'Disabled', globalRole: 'super_admin', active: false }),
    listMemberships: async () => [],
  } });
  const response = await request('/v1/organizations', dependencies, { authorization: 'Bearer valid.jwt.value' });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: { code: 'TECHNICIAN_DISABLED', message: 'Access denied' } });
  assert.ok(!response.body.includes('Disabled'));
});

test('missing and legacy session transports never authenticate', async () => {
  const invalidHeaders: Record<string, string | string[]>[] = [
    {}, { 'x-appwrite-session': '' },
    { 'x-appwrite-session': 'legacy-secret' },
    { 'x-appwrite-session': ['legacy-secret', 'legacy-secret'] },
    { cookie: 'a_session_test-project=legacy-secret' },
    { cookie: 'a_session_test-project=%ZZ' },
    { cookie: 'a_session_test-project=' },
  ];
  for (const headers of invalidHeaders) {
    const response = await request('/v1/me', services(), headers);
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
  }
});

test('missing profile does not reveal identity details', async () => {
  const headers = { authorization: 'Bearer valid.jwt.value' };
  const missing = await request('/v1/me', services({ technicians: {
    findByUserId: async () => null, listMemberships: async () => [],
  } }), headers);
  assert.equal(missing.statusCode, 403);
  assert.deepEqual(missing.json(), { error: { code: 'TECHNICIAN_DISABLED', message: 'Access denied' } });
});

test('authorization store errors have a stable response without internal details', async () => {
  const response = await request('/v1/me', services({ technicians: {
    findByUserId: async () => { throw new Error('internal database identifier'); },
    listMemberships: async () => [],
  } }), { authorization: 'Bearer valid.jwt.value' });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: { code: 'AUTHORIZATION_UNAVAILABLE', message: 'Access unavailable' } });
  assert.ok(!response.body.includes('internal database identifier'));
});

test('verifier outage returns a generic recoverable error', async () => {
  const response = await request('/v1/me', services({
    jwtVerifier: { verify: async () => { throw new Error('upstream timeout details'); } },
  }), { authorization: 'Bearer valid.jwt.value' });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: { code: 'AUTHORIZATION_UNAVAILABLE', message: 'Access unavailable' } });
  assert.ok(!response.body.includes('upstream timeout details'));
});

test('technician routes reject unknown query fields', async () => {
  for (const path of ['/v1/me?organizationId=org-other', '/v1/organizations?organizationId=org-other']) {
    const response = await request(path, services(), { authorization: 'Bearer valid.jwt.value' });
    assert.equal(response.statusCode, 400);
  }
});

test('device Bearer on an agent route does not enter technician authentication', async () => {
  const app = buildApp({ logger: false }, services());
  app.get('/v1/agent/test', async () => ({ status: 'agent-route' }));
  try {
    const response = await app.inject({ method: 'GET', url: '/v1/agent/test',
      headers: { authorization: 'Bearer synthetic-device-token' } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'agent-route' });
  } finally { await app.close(); }
});
