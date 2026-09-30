import type { FastifyRequest } from 'fastify';
import { hashToken } from '../security/tokens.ts';

export function deviceTokenHashFromRequest(request: FastifyRequest): string | null {
  const values: string[] = [];
  for (let index = 0; index < request.raw.rawHeaders.length; index += 2) {
    if (request.raw.rawHeaders[index]?.toLowerCase() === 'authorization') {
      values.push(request.raw.rawHeaders[index + 1] ?? '');
    }
  }
  if (values.length !== 1 || values[0]!.length > 519) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(values[0]!);
  if (!match) return null;
  const token = match[1]!;
  if (Buffer.from(token, 'base64url').toString('base64url') !== token) return null;
  return hashToken(token);
}
