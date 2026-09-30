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
    sessionVerifier: { verify: async (session) => session === 'valid-session' ? { userId: 'user-1' } : null },
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
  const headers = { 'x-appwrite-session': 'valid-session' };
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

test('member sees only active can_view memberships regardless of client organization ID', async () => {
  const dependencies = services({ technicians: {
    findByUserId: async () => ({ userId: 'user-1', displayName: 'Member', active: true }),
    listMemberships: async () => [
      { organizationId: 'org-active', userId: 'user-1', role: 'operator', canView: true, canConnect: false, canManageDevices: false },
      { organizationId: 'org-other', userId: 'user-1', role: 'operator', canView: false, canConnect: true, canManageDevices: true },
      { organizationId: 'org-disabled', userId: 'user-1', role: 'operator', canView: true, canConnect: true, canManageDevices: true },
      { organizationId: 'org-other', userId: 'different-user', role: 'operator', canView: true, canConnect: true, canManageDevices: true },
    ],
  } });
  const headers = { 'x-appwrite-session': 'valid-session' };
  const me = await request('/v1/me?organizationId=org-other', dependencies, headers);
  const list = await request('/v1/organizations?organizationId=org-other', dependencies, headers);
  assert.equal(me.statusCode, 200);
  assert.deepEqual(me.json(), { id: 'user-1', displayName: 'Member', globalRole: null, authorization: [
    { organizationId: 'org-active', role: 'operator', canView: true, canConnect: false, canManageDevices: false },
  ] });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json(), { organizations: [{ id: 'org-active', name: 'Active', slug: 'active' }] });
});

test('expired session has a generic stable authentication error', async () => {
  const response = await request('/v1/me', services(), { 'x-appwrite-session': 'expired-session' });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
  assert.ok(!response.body.includes('expired-session'));
});

test('disabled profile has a generic stable authorization error', async () => {
  const dependencies = services({ technicians: {
    findByUserId: async () => ({ userId: 'user-1', displayName: 'Disabled', globalRole: 'super_admin', active: false }),
    listMemberships: async () => [],
  } });
  const response = await request('/v1/organizations', dependencies, { 'x-appwrite-session': 'valid-session' });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: { code: 'TECHNICIAN_DISABLED', message: 'Access denied' } });
  assert.ok(!response.body.includes('Disabled'));
});

test('missing, empty, multiple, and ambiguous transports never authenticate', async () => {
  const invalidHeaders: Record<string, string | string[]>[] = [
    {}, { 'x-appwrite-session': '' },
    { 'x-appwrite-session': 'valid-session, valid-session' },
    { 'x-appwrite-session': ['valid-session', 'valid-session'] },
    { 'x-appwrite-session': 'valid-session', cookie: 'a_session_test-project=valid-session' },
    { cookie: 'a_session_test-project=valid-session; a_session_test-project=valid-session' },
    { cookie: 'a_session_test-project=' },
  ];
  for (const headers of invalidHeaders) {
    const response = await request('/v1/me', services(), headers);
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
  }
});

test('project session cookie authenticates when it is the only credential', async () => {
  const response = await request('/v1/me', services(), { cookie: 'a_session_test-project=valid-session' });
  assert.equal(response.statusCode, 200);
});

test('session verifier failure and missing profile do not reveal identity details', async () => {
  const headers = { 'x-appwrite-session': 'valid-session' };
  const unavailable = await request('/v1/me', services({
    sessionVerifier: { verify: async () => { throw new Error('private session detail'); } },
  }), headers);
  assert.equal(unavailable.statusCode, 401);
  assert.deepEqual(unavailable.json(), { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
  assert.ok(!unavailable.body.includes('private session detail'));

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
  } }), { 'x-appwrite-session': 'valid-session' });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: { code: 'AUTHORIZATION_UNAVAILABLE', message: 'Access unavailable' } });
  assert.ok(!response.body.includes('internal database identifier'));
});
