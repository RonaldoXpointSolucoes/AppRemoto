import { createHash, randomBytes } from 'node:crypto';

const maxTokenLength = 512;

export function issueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  if (typeof token !== 'string' || token.length === 0 || token.length > maxTokenLength) {
    throw new Error('Invalid token');
  }
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
