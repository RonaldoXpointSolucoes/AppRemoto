import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { createAppwriteServices } from './appwrite/client.ts';
import type { ApiConfig } from './config.ts';

test('JWT verifier uses a per-request Appwrite JWT client and classifies 401 versus 503', async () => {
  const observed: { jwt?: string; session?: string; key?: string; project?: string }[] = [];
  const server = createServer((request, response) => {
    observed.push({
      jwt: request.headers['x-appwrite-jwt'] as string | undefined,
      session: request.headers['x-appwrite-session'] as string | undefined,
      key: request.headers['x-appwrite-key'] as string | undefined,
      project: request.headers['x-appwrite-project'] as string | undefined,
    });
    const token = request.headers['x-appwrite-jwt'];
    response.setHeader('content-type', 'application/json');
    if (token === 'valid.jwt.value') {
      response.writeHead(200).end(JSON.stringify({ $id: 'user-1', status: true }));
    } else if (token === 'expired.jwt.value') {
      response.writeHead(401).end(JSON.stringify({ message: 'private invalid token detail', code: 401 }));
    } else {
      response.writeHead(503).end(JSON.stringify({ message: 'private upstream detail', code: 503 }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const config: ApiConfig = {
      appwriteEndpoint: `http://127.0.0.1:${address.port}/v1`,
      appwriteProjectId: 'test-project', appwriteApiKey: 'synthetic-key',
      masterEncryptionKey: Buffer.alloc(32), allowedOrigins: [], port: 3000,
    };
    const verifier = createAppwriteServices(config).jwtVerifier;
    assert.deepEqual(await verifier.verify('valid.jwt.value'), { userId: 'user-1' });
    assert.equal(await verifier.verify('expired.jwt.value'), null);
    await assert.rejects(verifier.verify('unavailable.jwt.value'), /Authentication service unavailable/);
    assert.deepEqual(observed, [
      { jwt: 'valid.jwt.value', session: undefined, key: undefined, project: 'test-project' },
      { jwt: 'expired.jwt.value', session: undefined, key: undefined, project: 'test-project' },
      { jwt: 'unavailable.jwt.value', session: undefined, key: undefined, project: 'test-project' },
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('JWT verifier maps a network failure to generic unavailability', async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

  const verifier = createAppwriteServices({
    appwriteEndpoint: `http://127.0.0.1:${address.port}/v1`,
    appwriteProjectId: 'test-project', appwriteApiKey: 'synthetic-key',
    masterEncryptionKey: Buffer.alloc(32), allowedOrigins: [], port: 3000,
  }).jwtVerifier;
  await assert.rejects(verifier.verify('valid.jwt.value'), /^Error: Authentication service unavailable$/);
});
