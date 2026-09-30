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
