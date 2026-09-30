import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readApiConfig } from './config.ts';

test('production configuration rejects missing required values without revealing secrets', () => {
  const secret = 'synthetic-secret-value';

  assert.throws(
    () => readApiConfig({ APPWRITE_API_KEY: secret }),
    (error: unknown) => error instanceof Error &&
      error.message.includes('APPWRITE_ENDPOINT') &&
      !error.message.includes(secret),
  );
});

test('production configuration accepts valid injected values', () => {
  const config = readApiConfig({
    APPWRITE_ENDPOINT: 'https://appwrite.example.test/v1',
    APPWRITE_PROJECT_ID: 'test-project',
    APPWRITE_API_KEY: 'synthetic-api-key',
    MASTER_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    ALLOWED_ORIGINS: 'https://panel.example.test',
    PORT: '8080',
  });

  assert.equal(config.port, 8080);
  assert.deepEqual(config.allowedOrigins, ['https://panel.example.test']);
});

const environment = { APPWRITE_ENDPOINT: 'https://appwrite.example.test/v1', APPWRITE_PROJECT_ID: 'test',
  APPWRITE_API_KEY: 'synthetic', MASTER_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  ALLOWED_ORIGINS: 'https://panel.example.test' };

test('enrollment configuration defaults to one process and untrusted proxy with a versioned key', () => {
  const config = readApiConfig(environment);
  assert.equal(config.apiReplicas, 1); assert.equal(config.trustProxy, false); assert.equal(config.encryptionKeyVersion, 1);
  const custom = readApiConfig({ ...environment, TRUST_PROXY: '127.0.0.1,10.0.0.0/8', MASTER_ENCRYPTION_KEY_VERSION: '2' });
  assert.deepEqual(custom.trustProxy, ['127.0.0.1', '10.0.0.0/8']); assert.equal(custom.encryptionKeyVersion, 2);
});

test('enrollment configuration refuses replica/process scaling, unrestricted proxy trust and invalid key versions', () => {
  for (const extra of [{ API_REPLICAS: '2' }, { API_REPLICAS: '0' }, { WEB_CONCURRENCY: '2' },
    { NODE_APP_INSTANCE: '1' }, { TRUST_PROXY: 'true' }, { TRUST_PROXY: '*' }, { TRUST_PROXY: '10.0.0.0/33' },
    { MASTER_ENCRYPTION_KEY_VERSION: '0' }, { MASTER_ENCRYPTION_KEY_VERSION: '65536' }]) {
    assert.throws(() => readApiConfig({ ...environment, ...extra }));
  }
});
