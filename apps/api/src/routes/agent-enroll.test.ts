import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { registerAgentEnrollRoute } from './agent-enroll.ts';
import { buildApp } from '../app.ts';
import type { TechnicianServices } from '../plugins/technician-auth.ts';

const payload = { enrollmentToken: 'synthetic-enrollment-secret-000000000',
  deviceUuid: '00000000-0000-4000-8000-000000000001', displayName: 'Test PC', hostname: 'test-pc',
  operatingSystem: 'Windows', osVersion: '11', agentVersion: '1', rustdeskId: '123', rustdeskVersion: '1' };
const result = { deviceId: 'device', deviceToken: 't'.repeat(43), rustdeskPassword: 'Password123!', heartbeatIntervalSeconds: 30 };

test('strict body validation rejects extras, missing values, malformed JSON and secrets in query', async () => {
  let calls = 0; const app = Fastify(); registerAgentEnrollRoute(app, async () => { calls++; return result; });
  try {
    for (const body of [{ ...payload, organizationId: 'other' }, { ...payload, enrollmentToken: undefined }, '{secret']) {
      const response = await app.inject({ method: 'POST', url: '/v1/agent/enroll', payload: body, headers: { 'content-type': 'application/json' } });
      assert.equal(response.statusCode, 400); assert.equal(response.json().error.code, 'INVALID_ENROLLMENT');
      assert.ok(!response.body.includes('secret'));
    }
    const response = await app.inject({ method: 'POST', url: '/v1/agent/enroll?token=secret', payload });
    assert.equal(response.statusCode, 400); assert.equal(calls, 0);
  } finally { await app.close(); }
});

test('source IP ignores forwarded headers by default and respects explicitly configured proxy', async () => {
  for (const trustProxy of [false, ['127.0.0.1']]) {
    const ips: string[] = []; const app = Fastify({ trustProxy });
    registerAgentEnrollRoute(app, async (_body, ip) => { ips.push(ip); return result; });
    try {
      const response = await app.inject({ method: 'POST', url: '/v1/agent/enroll', payload,
        remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '192.0.2.1' } });
      assert.equal(response.statusCode, 200); assert.deepEqual(ips, [trustProxy ? '192.0.2.1' : '127.0.0.1']);
      assert.equal(response.headers['cache-control'], 'no-store');
    } finally { await app.close(); }
  }
});

test('bounded rate limit counts canonical IP and token hash, resets and fails closed at capacity', async () => {
  let clock = 0; const app = Fastify();
  registerAgentEnrollRoute(app, async () => result, { limit: 2, windowMs: 1000, maxEntries: 2, now: () => clock });
  const send = (ip = '127.0.0.1', token = payload.enrollmentToken) => app.inject({ method: 'POST', url: '/v1/agent/enroll',
    payload: { ...payload, enrollmentToken: token }, remoteAddress: ip });
  try {
    assert.equal((await send()).statusCode, 200);
    assert.equal((await send('::ffff:127.0.0.1')).statusCode, 200);
    assert.equal((await send()).statusCode, 429);
    assert.equal((await send('192.0.2.1')).statusCode, 200);
    assert.equal((await send('192.0.2.2', 'x'.repeat(32))).statusCode, 429);
    clock = 1000; assert.equal((await send()).statusCode, 200);
  } finally { await app.close(); }
});

test('untrusted structured failures are never returned or logged', async () => {
  const logs: string[] = []; const app = Fastify({ logger: { stream: { write: (line: string) => logs.push(line) } } });
  registerAgentEnrollRoute(app, async () => { throw { message: payload.enrollmentToken, token: 'private-token', nested: { password: 'private-password' } }; });
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/agent/enroll', payload });
    assert.equal(response.statusCode, 503); assert.deepEqual(response.json(), { error: { code: 'ENROLLMENT_UNAVAILABLE', message: 'Enrollment unavailable' } });
    for (const secret of [payload.enrollmentToken, 'private-token', 'private-password']) assert.ok(!JSON.stringify(logs).includes(secret));
  } finally { await app.close(); }
});

test('request logs omit enrollment secrets even on rejected query and oversized malformed requests', async () => {
  const logs: string[] = []; const app = Fastify({ logger: { stream: { write: (line: string) => logs.push(line) } } });
  registerAgentEnrollRoute(app, async () => result);
  try {
    await app.inject({ method: 'POST', url: `/v1/agent/enroll?token=${payload.enrollmentToken}`, payload });
    await app.inject({ method: 'POST', url: '/v1/agent/enroll', payload: JSON.stringify({ password: 'secret-password', body: 'x'.repeat(9000) }),
      headers: { 'content-type': 'application/json' } });
    assert.ok(!JSON.stringify(logs).includes(payload.enrollmentToken));
    assert.ok(!JSON.stringify(logs).includes('secret-password'));
  } finally { await app.close(); }
});

test('application registers enrollment independently of technician authentication', async () => {
  const services = { enrollDevice: async () => result } as unknown as TechnicianServices;
  const app = buildApp({ logger: false }, services);
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/agent/enroll', payload });
    assert.equal(response.statusCode, 200); assert.deepEqual(response.json(), result);
  } finally { await app.close(); }
});

test('global request logging never leaks query secrets on POST, OPTIONS, GET, not-found and errors', async () => {
  const logs: string[] = []; const secret = 'QUERY-SECRET-SENTINEL';
  const app = buildApp({ logger: { stream: { write: (line: string) => logs.push(line) } } },
    { enrollDevice: async () => result } as unknown as TechnicianServices, ['https://panel.example.test']);
  app.get('/synthetic-error', async () => { throw new Error(secret); });
  try {
    for (const method of ['POST', 'OPTIONS', 'GET'] as const) {
      await app.inject({ method, url: `/v1/agent/enroll?token=${secret}`, ...(method === 'POST' ? { payload } : {}),
        headers: { origin: 'https://panel.example.test', 'access-control-request-method': 'POST' } });
    }
    await app.inject({ url: `/missing?token=${secret}` }); await app.inject({ url: `/synthetic-error?token=${secret}` });
    assert.ok(!logs.join('').includes(secret));
  } finally { await app.close(); }
});

test('source-IP admission prevents rotating tokens from consuming unrelated client capacity', async () => {
  let time = 0; let calls = 0; const app = Fastify();
  registerAgentEnrollRoute(app, async () => { calls++; return result; }, { limit: 2, maxEntries: 3, now: () => time, windowMs: 1000 });
  const send = (ip: string, token: string) => app.inject({ method: 'POST', url: '/v1/agent/enroll',
    remoteAddress: ip, payload: { ...payload, enrollmentToken: token.repeat(32) } });
  try {
    assert.equal((await send('127.0.0.1', 'a')).statusCode, 200);
    assert.equal((await send('::ffff:127.0.0.1', 'b')).statusCode, 200);
    assert.equal((await send('127.0.0.1', 'c')).statusCode, 429);
    assert.equal((await send('192.0.2.1', 'd')).statusCode, 200); assert.equal(calls, 3);
    time = 1000; assert.equal((await send('127.0.0.1', 'e')).statusCode, 200);
  } finally { await app.close(); }
});

test('reconfiguration route validates both proofs, shares limits and exposes only acknowledgement', async () => {
  const logs: string[] = []; const proof = 'A'.repeat(43); let calls = 0;
  const app = Fastify({ logger: { stream: { write: (line: string) => logs.push(line) } } });
  const enroll = Object.assign(async () => result, { reconfigure: async () => { calls++; return { deviceId: 'device', reconfigured: true as const }; } });
  registerAgentEnrollRoute(app, enroll, { limit: 2 });
  try {
    const send = (body: unknown, query = '') => app.inject({ method: 'POST', url: '/v1/agent/reconfigure' + query, payload: body as object });
    assert.equal((await send(payload)).statusCode, 400);
    assert.equal((await send({ ...payload, currentDeviceToken: proof }, '?token=' + proof)).statusCode, 400);
    const response = await send({ ...payload, currentDeviceToken: proof });
    assert.equal(response.statusCode, 200); assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.json(), { deviceId: 'device', reconfigured: true });
    assert.equal((await app.inject({ method: 'POST', url: '/v1/agent/enroll', payload })).statusCode, 200);
    assert.equal((await send({ ...payload, currentDeviceToken: proof })).statusCode, 429);
    assert.equal(calls, 1);
    for (const secret of [proof, payload.enrollmentToken, result.rustdeskPassword]) assert.ok(!logs.join('').includes(secret));
  } finally { await app.close(); }
});
