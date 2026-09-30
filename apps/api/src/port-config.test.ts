import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readApiConfig } from './config.ts';

const environment = {
  APPWRITE_ENDPOINT: 'https://appwrite.xpointsolucoes.com.br/v1',
  APPWRITE_PROJECT_ID: '6abc5640003cb361b809',
  APPWRITE_API_KEY: 'synthetic',
  MASTER_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  ALLOWED_ORIGINS: 'https://panel.example.test',
};

test('PORT accepts only canonical decimal values safe for the container health URL', () => {
  assert.equal(readApiConfig({ ...environment, PORT: '1' }).port, 1);
  assert.equal(readApiConfig({ ...environment, PORT: '3000' }).port, 3000);
  assert.equal(readApiConfig({ ...environment, PORT: '65535' }).port, 65535);

  for (const port of ['0', '65536', '03000', '+3000', '3e3', '3000.0', ' 3000 ', '']) {
    assert.throws(() => readApiConfig({ ...environment, PORT: port }), /PORT must be an integer/);
  }
});
