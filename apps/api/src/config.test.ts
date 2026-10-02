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
    APPWRITE_ENDPOINT: 'https://appwrite.xpointsolucoes.com.br/v1',
    APPWRITE_PROJECT_ID: '6abc5640003cb361b809',
    APPWRITE_API_KEY: 'synthetic-api-key',
    MASTER_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    ALLOWED_ORIGINS: 'https://panel.example.test',
    PORT: '8080',
  });

  assert.equal(config.port, 8080);
  assert.deepEqual(config.allowedOrigins, ['https://panel.example.test']);
});

const environment = { APPWRITE_ENDPOINT: 'https://appwrite.xpointsolucoes.com.br/v1', APPWRITE_PROJECT_ID: '6abc5640003cb361b809',
  APPWRITE_API_KEY: 'synthetic', MASTER_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  ALLOWED_ORIGINS: 'https://panel.example.test' };

test('generic shared password is optional and respects the Windows 128-byte UTF-8 boundary without echoing values', () => {
  assert.equal(readApiConfig(environment).genericInstallerSharedPassword, undefined);
  const boundary = 'á'.repeat(64);
  assert.equal(readApiConfig({ ...environment, GENERIC_INSTALLER_SHARED_PASSWORD: boundary }).genericInstallerSharedPassword, boundary);
  for (const value of ['short', 'a'.repeat(129), 'á'.repeat(65), 'a'.repeat(16) + '\n', '\ud800'.repeat(16)]) {
    assert.throws(() => readApiConfig({ ...environment, GENERIC_INSTALLER_SHARED_PASSWORD: value }),
      (error: unknown) => error instanceof Error && !error.message.includes(value));
  }
});

test('enrollment configuration defaults to one process and untrusted proxy with a versioned key', () => {
  const config = readApiConfig(environment);
  assert.equal(config.apiReplicas, 1); assert.equal(config.trustProxy, false); assert.equal(config.encryptionKeyVersion, 1);
  const custom = readApiConfig({ ...environment, TRUST_PROXY: '127.0.0.1,10.0.0.0/8', MASTER_ENCRYPTION_KEY_VERSION: '2' });
  assert.deepEqual(custom.trustProxy, ['127.0.0.1', '10.0.0.0/8']); assert.equal(custom.encryptionKeyVersion, 2);
});

test('rejects every nonliteral Appwrite target before reading the API key', () => {
  const invalidTargets = [
    { APPWRITE_ENDPOINT: 'https://APPWRITE.xpointsolucoes.com.br/v1' },
    { APPWRITE_ENDPOINT: 'https://appwrite.xpointsolucoes.com.br/v1/' },
    { APPWRITE_ENDPOINT: 'https://appwrite.xpointsolucoes.com.br/v1?key=private' },
    { APPWRITE_ENDPOINT: 'https://user:pass@appwrite.xpointsolucoes.com.br/v1' },
    { APPWRITE_PROJECT_ID: 'default-6abc5640003cb361b809' },
    { APPWRITE_PROJECT_ID: 'another-project' },
  ];
  for (const changed of invalidTargets) {
    let keyRead = false;
    const values = { ...environment, ...changed };
    const guarded = new Proxy(values, { get(target, property, receiver) {
      if (property === 'APPWRITE_API_KEY') keyRead = true;
      return Reflect.get(target, property, receiver);
    } });
    assert.throws(() => readApiConfig(guarded));
    assert.equal(keyRead, false);
  }
});

test('enrollment configuration refuses replica/process scaling, unrestricted proxy trust and invalid key versions', () => {
  for (const extra of [{ API_REPLICAS: '2' }, { API_REPLICAS: '0' }, { WEB_CONCURRENCY: '2' },
    { NODE_APP_INSTANCE: '1' }, { TRUST_PROXY: 'true' }, { TRUST_PROXY: '*' }, { TRUST_PROXY: '10.0.0.0/33' },
    { MASTER_ENCRYPTION_KEY_VERSION: '0' }, { MASTER_ENCRYPTION_KEY_VERSION: '65536' }]) {
    assert.throws(() => readApiConfig({ ...environment, ...extra }));
  }
});
