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
  const result = redactLogData(input);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
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
  assert.notEqual(result, input);
  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.getPrototypeOf(result.nested), null);
  assert.equal(Object.getPrototypeOf(result.nested[0]), null);
});

test('redactLogData safely handles cyclic data without leaking sensitive fields', () => {
  const input: { label: string; Authorization: string; self?: unknown } = {
    label: 'safe', Authorization: 'private',
  };
  input.self = input;
  assert.deepEqual(JSON.parse(JSON.stringify(redactLogData(input))), {
    label: 'safe', Authorization: '[REDACTED]', self: '[Circular]',
  });
  assert.equal(input.Authorization, 'private');
  assert.equal(input.self, input);
});

test('redactLogData preserves an own __proto__ field on an inert output object', () => {
  const input = JSON.parse('{"__proto__":"safe","password":"private"}') as Record<string, string>;
  const result = redactLogData(input);
  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.getOwnPropertyDescriptor(result, '__proto__')?.value, 'safe');
  assert.equal(result.password, '[REDACTED]');
});

test('redactLogData returns inert data even when an input serializer or callable contains a secret', () => {
  const sentinel = 'SYNTHETIC_SENTINEL_1';
  const input = {
    password: sentinel,
    toJSON() { return { password: sentinel }; },
    nested: { callback: () => sentinel, value: 'safe' },
  };
  const result = redactLogData(input);
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  assert.equal(typeof (result as { toJSON?: unknown }).toJSON, 'undefined');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    password: '[REDACTED]', nested: { callback: '[REDACTED]', value: 'safe' },
  });
});

test('redactLogData covers case and separator variants of key material and cookies', () => {
  const sentinel = 'SYNTHETIC_SENTINEL_2';
  const input = {
    PRIVATEKEY: sentinel, privateKey: sentinel, private_key: sentinel, 'private-key': sentinel,
    ENCRYPTIONKEY: sentinel, encryptionKey: sentinel, 'api-key': sentinel,
    cookies: sentinel, COOKIES: sentinel, setCookie: sentinel, SETCOOKIE: sentinel,
    keyboard: 'safe',
  };
  const result = redactLogData(input);
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  assert.equal(result.keyboard, 'safe');
});

test('redactLogData traverses arrays without invoking overridden methods or index getters', () => {
  const sentinel = 'SYNTHETIC_SENTINEL_3';
  const input: unknown[] = [{ password: sentinel }];
  Object.defineProperty(input, 'map', { value() { return input; }, configurable: true });
  let getterCalls = 0;
  Object.defineProperty(input, 1, {
    enumerable: true, configurable: true,
    get() { getterCalls += 1; return sentinel; },
  });
  const result = redactLogData(input);
  assert.equal(getterCalls, 0);
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),
    [{ password: '[REDACTED]' }, '[REDACTED]']);
  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(input.map instanceof Function, true);
});

test('redactLogData uses built-in Date access and contains exotic failures', () => {
  const sentinel = 'SYNTHETIC_SENTINEL_4';
  const date = new Date('2026-09-30T12:00:00.000Z');
  Object.defineProperty(date, 'getTime', { value() { throw new Error(sentinel); } });
  assert.equal(JSON.stringify(redactLogData({ date })),
    '{"date":"2026-09-30T12:00:00.000Z"}');
  const exotic = Object.create(Date.prototype) as Date;
  assert.equal(JSON.stringify(redactLogData({ exotic })).includes(sentinel), false);
  const target = { password: sentinel };
  const proxy = new Proxy(target, { ownKeys() { throw new Error(sentinel); } });
  assert.equal(JSON.stringify(redactLogData({ proxy })), '{"proxy":"[REDACTED]"}');
});

test('redactLogData masks rawHeaders and tuple header values in serialized output', () => {
  const sentinel = 'SYNTHETIC_SENTINEL_5';
  const input = {
    rawHeaders: ['Authorization', `Bearer ${sentinel}`, 'Cookie', sentinel,
      'Set-Cookie', `sid=${sentinel}`],
    headers: [['Authorization', `Bearer ${sentinel}`], ['Cookie', sentinel],
      ['Set-Cookie', sentinel], ['X-Trace', 'safe-trace']],
  };
  const result = redactLogData(input);
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  assert.equal(input.rawHeaders[1], `Bearer ${sentinel}`);
});

test('encryptPassword preserves BOM and valid Unicode at password boundaries', () => {
  for (const password of ['\uFEFF', '\uFEFFabc', '🔐'.repeat(64), 'x'.repeat(128)]) {
    assert.equal(decryptPassword(encryptPassword(password, masterKey), masterKey), password);
  }
  assert.throws(() => encryptPassword('x'.repeat(129), masterKey),
    { message: 'Invalid encryption parameters' });
});

test('encryptPassword rejects ill-formed UTF-16 without leaking plaintext', () => {
  for (const password of ['\uD800', '\uDC00', 'prefix\uD800suffix', '\uD800A']) {
    assert.throws(() => encryptPassword(password, masterKey),
      { message: 'Invalid encryption parameters' });
  }
});
