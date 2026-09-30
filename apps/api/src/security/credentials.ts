import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface PasswordEnvelope {
  passwordCiphertext: string;
  passwordNonce: string;
  passwordTag: string;
  keyVersion: number;
}

const maxPasswordLength = 128;
const maxKeyVersion = 65535;
const defaultKeyVersion = 1;
const decryptError = 'Unable to decrypt password';

function validKey(key: Buffer): boolean {
  return Buffer.isBuffer(key) && key.length === 32;
}

function validVersion(version: number): boolean {
  return Number.isInteger(version) && version >= 1 && version <= maxKeyVersion;
}

function wellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function aad(version: number): Buffer {
  return Buffer.from(`appremoto:device-credentials:password:v1:key-version:${version}`, 'utf8');
}

function decodeCanonical(value: unknown, minBytes: number, maxBytes: number): Buffer | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 4096) {
    return null;
  }
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length >= minBytes && bytes.length <= maxBytes &&
    bytes.toString('base64url') === value ? bytes : null;
}

export function encryptPassword(password: string, key: Buffer,
  keyVersion = defaultKeyVersion): PasswordEnvelope {
  if (typeof password !== 'string' || password.length < 1 || password.length > maxPasswordLength ||
    !wellFormedUtf16(password) || !validKey(key) || !validVersion(keyVersion)) {
    throw new Error('Invalid encryption parameters');
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(aad(keyVersion));
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return {
    passwordCiphertext: ciphertext.toString('base64url'),
    passwordNonce: nonce.toString('base64url'),
    passwordTag: cipher.getAuthTag().toString('base64url'),
    keyVersion,
  };
}

export function decryptPassword(envelope: unknown, key: Buffer,
  expectedKeyVersion = defaultKeyVersion): string {
  try {
    if (!validKey(key) || !validVersion(expectedKeyVersion) ||
      envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
      throw new Error(decryptError);
    }
    const fields = Object.keys(envelope);
    if (fields.length !== 4 || !fields.every((field) =>
      ['passwordCiphertext', 'passwordNonce', 'passwordTag', 'keyVersion'].includes(field))) {
      throw new Error(decryptError);
    }
    const value = envelope as PasswordEnvelope;
    if (!validVersion(value.keyVersion) || value.keyVersion !== expectedKeyVersion) {
      throw new Error(decryptError);
    }
    const ciphertext = decodeCanonical(value.passwordCiphertext, 1, 512);
    const nonce = decodeCanonical(value.passwordNonce, 12, 12);
    const tag = decodeCanonical(value.passwordTag, 16, 16);
    if (!ciphertext || !nonce || !tag) throw new Error(decryptError);

    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    decipher.setAAD(aad(value.keyVersion));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const password = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(plaintext);
    if (password.length < 1 || password.length > maxPasswordLength) throw new Error(decryptError);
    return password;
  } catch {
    throw new Error(decryptError);
  }
}
