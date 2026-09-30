import { isIP } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { EnrollRequestSchema, EnrollResponseSchema } from '@appremoto/contracts';
import { hashToken } from '../security/tokens.ts';
import { EnrollmentError, type EnrollDevice } from '../services/enroll-device.ts';

interface RateOptions { limit?: number; windowMs?: number; maxEntries?: number; now?: () => number }

function canonicalIp(value: string): string | null {
  if (!isIP(value)) return null;
  if (isIP(value) === 4) return value;
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(normalized);
  if (mapped) {
    const high = parseInt(mapped[1]!, 16); const low = parseInt(mapped[2]!, 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  return normalized;
}

export function registerAgentEnrollRoute(app: FastifyInstance, enroll: EnrollDevice, options: RateOptions = {}): void {
  const limit = options.limit ?? 10; const windowMs = options.windowMs ?? 60_000;
  const maxEntries = options.maxEntries ?? 10_000; const now = options.now ?? Date.now;
  const buckets = new Map<string, { count: number; expires: number }>();
  const errorBody = (code: string, message: string) => ({ error: { code, message } });
  app.post('/v1/agent/enroll', {
    bodyLimit: 8192,
    childLoggerFactory: (logger, bindings, options) => logger.child(bindings, {
      ...options, serializers: {
        req: (request: { method: string }) => ({ method: request.method, route: '/v1/agent/enroll' }),
        err: () => ({ code: 'ENROLLMENT_UNAVAILABLE' }),
      },
    }),
    errorHandler: (_error, _request, reply) => reply.code(400).send(errorBody('INVALID_ENROLLMENT', 'Invalid enrollment')),
  }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const body = EnrollRequestSchema.safeParse(request.body);
    const sourceIp = canonicalIp(request.ip);
    if (!body.success || !sourceIp || Object.keys(request.query as object).length !== 0) {
      return reply.code(400).send(errorBody('INVALID_ENROLLMENT', 'Invalid enrollment'));
    }
    const time = now();
    for (const [key, bucket] of buckets) if (bucket.expires <= time) buckets.delete(key);
    const key = `${sourceIp}:${hashToken(body.data.enrollmentToken)}`;
    let bucket = buckets.get(key);
    if ((!bucket && buckets.size >= maxEntries) || (bucket && bucket.count >= limit)) {
      return reply.code(429).send(errorBody('ENROLLMENT_RATE_LIMITED', 'Enrollment rate limited'));
    }
    if (!bucket) { bucket = { count: 0, expires: time + windowMs }; buckets.set(key, bucket); }
    bucket.count++;
    try { return EnrollResponseSchema.parse(await enroll(body.data, sourceIp)); }
    catch (error) {
      if (error instanceof EnrollmentError && error.code === 'ENROLLMENT_DENIED') {
        return reply.code(403).send(errorBody(error.code, 'Enrollment denied'));
      }
      request.log.warn({ code: 'ENROLLMENT_UNAVAILABLE' }, 'Enrollment unavailable');
      return reply.code(503).send(errorBody('ENROLLMENT_UNAVAILABLE', 'Enrollment unavailable'));
    }
  });
}
