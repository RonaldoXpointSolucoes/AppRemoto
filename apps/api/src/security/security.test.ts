import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

import { decryptPassword, encryptPassword } from './credentials.ts';
import { redactLogData } from './redaction.ts';
import { hashToken, issueToken } from './tokens.ts';

test('issueToken emits unique canonical 32-byte base64url tokens', () => {
  const tokens = Array.from({ length: 64 }, () => issueToken());
  assert.equal(new Set(tokens).size, tokens.length);
  for (const token of tokens) {
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const bytes = Buffer.from(token, 'base64url');
    assert.equal(bytes.length, 32);
    assert.equal(bytes.toString('base64url'), token);
  }
});

test('hashToken hashes the exact UTF-8 bytes to lowercase SHA-256 hex', () => {
  const token = 'aBc_☃';
  const expected = 'c8b38997a6c2f8f6d713b832ba4c32a25a7ecdf85a4124b4b186c7a50852f180';
  assert.equal(hashToken(token), expected);
  assert.equal(hashToken(token), expected);
  assert.match(hashToken(token), /^[0-9a-f]{64}$/);
  assert.notEqual(hashToken('a'), hashToken('a '));
});

test('hashToken rejects invalid and oversized tokens', () => {
  for (const token of ['', 'x'.repeat(513), null, 1]) {
    assert.throws(() => hashToken(token as string), /Invalid token/);
  }
});

const masterKey = Buffer.alloc(32, 7);

test('encryptPassword round trips Unicode and emits schema-sized canonical fields', () => {
  const password = 'møt de passe ☃ 🔐';
  const envelope = encryptPassword(password, masterKey);
  assert.deepEqual(Object.keys(envelope).sort(),
    ['keyVersion', 'passwordCiphertext', 'passwordNonce', 'passwordTag'].sort());
  assert.equal(envelope.keyVersion, 1);
  assert.equal(Buffer.from(envelope.passwordNonce, 'base64url').length, 12);
  assert.equal(Buffer.from(envelope.passwordTag, 'base64url').length, 16);
  assert.equal(Buffer.from(envelope.passwordCiphertext, 'base64url').length,
    Buffer.byteLength(password, 'utf8'));
  for (const field of ['passwordCiphertext', 'passwordNonce', 'passwordTag'] as const) {
    assert.equal(Buffer.from(envelope[field], 'base64url').toString('base64url'), envelope[field]);
    assert.match(envelope[field], /^[A-Za-z0-9_-]+$/);
  }
  assert.equal(decryptPassword(envelope, masterKey), password);
});

test('encryptPassword uses a new nonce and ciphertext for repeated values', () => {
  const envelopes = Array.from({ length: 32 }, () => encryptPassword('same password', masterKey));
  assert.equal(new Set(envelopes.map((item) => item.passwordNonce)).size, envelopes.length);
  assert.equal(new Set(envelopes.map((item) => item.passwordCiphertext)).size, envelopes.length);
});

test('decryptPassword fails generically for tampering, wrong key and key version', () => {
  const envelope = encryptPassword('correct horse battery', masterKey, 2);
  assert.equal(decryptPassword(envelope, masterKey, 2), 'correct horse battery');
  const changes = [
    { passwordCiphertext: Buffer.from('tampered').toString('base64url') },
    { passwordNonce: randomBytes(12).toString('base64url') },
    { passwordTag: randomBytes(16).toString('base64url') },
    { keyVersion: 3 },
  ];
  for (const change of changes) {
    assert.throws(() => decryptPassword({ ...envelope, ...change }, masterKey, 2),
      { message: 'Unable to decrypt password' });
  }
  assert.throws(() => decryptPassword(envelope, Buffer.alloc(32, 8), 2),
    { message: 'Unable to decrypt password' });
  assert.throws(() => decryptPassword(envelope, masterKey),
    { message: 'Unable to decrypt password' });
});

test('decryptPassword rejects malformed and noncanonical envelopes', () => {
  const envelope = encryptPassword('correct horse battery', masterKey);
  const malformed: unknown[] = [null, {}, { ...envelope, extra: 'value' },
    { ...envelope, passwordNonce: '' },
    { ...envelope, passwordNonce: 'AA' },
    { ...envelope, passwordNonce: envelope.passwordNonce + '=' },
    { ...envelope, passwordTag: envelope.passwordTag + '=' },
    { ...envelope, passwordCiphertext: envelope.passwordCiphertext + '=' },
    { ...envelope, passwordCiphertext: '%%%%' },
    { ...envelope, keyVersion: 0 },
    { ...envelope, keyVersion: 1.5 },
    { ...envelope, keyVersion: 65536 },
  ];
  for (const value of malformed) {
    assert.throws(() => decryptPassword(value, masterKey),
      { message: 'Unable to decrypt password' });
  }
});

test('encryptPassword rejects unbounded plaintext, invalid key and version without echoing secrets', () => {
  for (const password of ['', 'x'.repeat(129), null]) {
    assert.throws(() => encryptPassword(password as string, masterKey),
      (error: unknown) => error instanceof Error && !error.message.includes('x'.repeat(129)));
  }
  assert.throws(() => encryptPassword('private value', Buffer.alloc(31)),
    { message: 'Invalid encryption parameters' });
  assert.throws(() => encryptPassword('private value', masterKey, 0),
    { message: 'Invalid encryption parameters' });
});

test('redactLogData recursively hides normalized sensitive fields in objects and arrays', () => {
  const input = {
    event: 'device.enrolled', deviceId: 'device-1',
    headers: { AUTHORIZATION: 'Bearer private', 'Set-Cookie': 'sid=private', 'x-api-key': 'private' },
    nested: [
      { PassWord: 'private', passphrase: 'private', SECRET_KEY: 'private', jwt: 'private' },
      { sessionId: 'private', credentialHash: 'private', password_ciphertext: 'private',
        passwordNonce: 'private', passwordTag: 'private', status: 'active' },
      { token: 'private', keyMaterial: 'private', cookie: 'private', note: 'safe' },
    ],
  };
  const snapshot = structuredClone(input);
  assert.deepEqual(redactLogData(input), {
    event: 'device.enrolled', deviceId: 'device-1',
    headers: { AUTHORIZATION: '[REDACTED]', 'Set-Cookie': '[REDACTED]', 'x-api-key': '[REDACTED]' },
    nested: [
      { PassWord: '[REDACTED]', passphrase: '[REDACTED]', SECRET_KEY: '[REDACTED]', jwt: '[REDACTED]' },
      { sessionId: '[REDACTED]', credentialHash: '[REDACTED]', password_ciphertext: '[REDACTED]',
        passwordNonce: '[REDACTED]', passwordTag: '[REDACTED]', status: 'active' },
      { token: '[REDACTED]', keyMaterial: '[REDACTED]', cookie: '[REDACTED]', note: 'safe' },
    ],
  });
  assert.deepEqual(input, snapshot);
  assert.notEqual(redactLogData(input), input);
});

test('redactLogData safely handles cyclic data without leaking sensitive fields', () => {
  const input: { label: string; Authorization: string; self?: unknown } = {
    label: 'safe', Authorization: 'private',
  };
  input.self = input;
  assert.deepEqual(redactLogData(input), {
    label: 'safe', Authorization: '[REDACTED]', self: '[Circular]',
  });
  assert.equal(input.Authorization, 'private');
  assert.equal(input.self, input);
});

test('redactLogData preserves an own __proto__ field without changing the output prototype', () => {
  const input = JSON.parse('{"__proto__":"safe","password":"private"}') as Record<string, string>;
  const result = redactLogData(input);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(result, '__proto__')?.value, 'safe');
  assert.equal(result.password, '[REDACTED]');
});
