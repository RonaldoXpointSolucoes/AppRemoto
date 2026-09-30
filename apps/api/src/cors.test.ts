import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildApp } from './app.ts';
import type { TechnicianServices } from './plugins/technician-auth.ts';

const services: TechnicianServices = {
  projectId: 'test-project',
  jwtVerifier: { verify: async () => ({ userId: 'user-1' }) },
  technicians: {
    findByUserId: async () => ({ userId: 'user-1', displayName: 'Technician', active: true, globalRole: 'super_admin' }),
    listMemberships: async () => [],
  },
  organizations: { listActive: async () => [] },
};

test('configured panel origin can preflight and read technician routes', async () => {
  const app = buildApp({ logger: false }, services, ['https://panel.example.test']);
  try {
    const preflight = await app.inject({ method: 'OPTIONS', url: '/v1/me', headers: {
      origin: 'https://panel.example.test',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization,content-type',
    } });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], 'https://panel.example.test');
    assert.match(String(preflight.headers['access-control-allow-headers']), /Authorization/i);
    assert.match(String(preflight.headers['access-control-allow-headers']), /Content-Type/i);

    const actual = await app.inject({ method: 'GET', url: '/v1/me', headers: {
      origin: 'https://panel.example.test', authorization: 'Bearer valid.jwt.value',
    } });
    assert.equal(actual.statusCode, 200);
    assert.equal(actual.headers['access-control-allow-origin'], 'https://panel.example.test');
  } finally { await app.close(); }
});

test('unlisted origin gets no access-control-allow-origin header', async () => {
  const app = buildApp({ logger: false }, services, ['https://panel.example.test']);
  try {
    const response = await app.inject({ method: 'GET', url: '/v1/me', headers: {
      origin: 'https://outside.example.test', authorization: 'Bearer valid.jwt.value',
    } });
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    const preflight = await app.inject({ method: 'OPTIONS', url: '/v1/me', headers: {
      origin: 'https://outside.example.test', 'access-control-request-method': 'GET',
    } });
    assert.equal(preflight.headers['access-control-allow-origin'], undefined);
  } finally { await app.close(); }
});
