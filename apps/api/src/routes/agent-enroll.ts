import { isIP } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { ReconfigureRequestSchema, ReconfigureResponseSchema, EnrollRequestSchema, EnrollResponseSchema,
  GenericPasswordResponseSchema, ConfirmGenericPasswordResponseSchema } from '@appremoto/contracts';
import { hashToken } from '../security/tokens.ts';
import { EnrollmentError, type EnrollDevice } from '../services/enroll-device.ts';
import { GenericPasswordError } from '../services/generic-password.ts';

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
  const sources = new Map<string, { count: number; expires: number; tokens: Map<string, number> }>();
  const errorBody = (code: string, message: string) => ({ error: { code, message } });
  for (const operation of ['enroll', 'reconfigure', 'generic-password', 'generic-password/confirm'] as const) {
    const reconfigure = operation !== 'enroll';
    const route = `/v1/agent/${operation}`;
    app.post(route, {
      bodyLimit: 8192,
      childLoggerFactory: (logger, bindings, options) => logger.child(bindings, {
        ...options, serializers: {
          req: (request: { method: string }) => ({ method: request.method, route }),
          err: () => ({ code: 'ENROLLMENT_UNAVAILABLE' }),
        },
      }),
      errorHandler: (_error, _request, reply) => reply.code(400).send(errorBody('INVALID_ENROLLMENT', 'Invalid enrollment')),
    }, async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const body = (reconfigure ? ReconfigureRequestSchema : EnrollRequestSchema).safeParse(request.body);
      const sourceIp = canonicalIp(request.ip);
      if (!body.success || !sourceIp || Object.keys(request.query as object).length !== 0) {
        return reply.code(400).send(errorBody('INVALID_ENROLLMENT', 'Invalid enrollment'));
      }
      const time = now();
      for (const [key, bucket] of sources) if (bucket.expires <= time) sources.delete(key);
      let bucket = sources.get(sourceIp);
      if ((!bucket && sources.size >= maxEntries) || (bucket && bucket.count >= limit)) {
        return reply.code(429).send(errorBody('ENROLLMENT_RATE_LIMITED', 'Enrollment rate limited'));
      }
      if (!bucket) { bucket = { count: 0, expires: time + windowMs, tokens: new Map() }; sources.set(sourceIp, bucket); }
      bucket.count++;
      const tokenHash = hashToken(body.data.enrollmentToken);
      const tokenCount = bucket.tokens.get(tokenHash) ?? 0;
      if (tokenCount >= limit) return reply.code(429).send(errorBody('ENROLLMENT_RATE_LIMITED', 'Enrollment rate limited'));
      bucket.tokens.set(tokenHash, tokenCount + 1);
      try {
        if (operation === 'generic-password' || operation === 'generic-password/confirm') {
          const confirm = operation === 'generic-password/confirm';
          if (!enroll.stageGenericPassword || !enroll.confirmGenericPassword) throw new GenericPasswordError();
          const input = ReconfigureRequestSchema.parse(body.data);
          return confirm ? ConfirmGenericPasswordResponseSchema.parse(await enroll.confirmGenericPassword(input, sourceIp)) :
            GenericPasswordResponseSchema.parse(await enroll.stageGenericPassword(input, sourceIp));
        }
        if (reconfigure) {
          if (!enroll.reconfigure) throw new Error('Reconfiguration unavailable');
          return ReconfigureResponseSchema.parse(await enroll.reconfigure(ReconfigureRequestSchema.parse(body.data), sourceIp));
        }
        return EnrollResponseSchema.parse(await enroll(body.data, sourceIp));
      }
      catch (error) {
        if (error instanceof GenericPasswordError) {
          request.log.warn({ code: error.code }, 'Generic password operation unavailable');
          return reply.code(error.code === 'GENERIC_PASSWORD_DENIED' ? 403 : error.code === 'GENERIC_PASSWORD_POLICY_CHANGED' ? 409 : 503)
            .send(errorBody(error.code, 'Generic password operation unavailable'));
        }
        if (error instanceof EnrollmentError && error.code === 'ENROLLMENT_DENIED') {
          request.log.warn({ code: 'ENROLLMENT_DENIED' }, 'Enrollment denied');
          return reply.code(403).send(errorBody(error.code, 'Enrollment denied'));
        }
        request.log.warn({ code: 'ENROLLMENT_UNAVAILABLE' }, 'Enrollment unavailable');
        return reply.code(503).send(errorBody('ENROLLMENT_UNAVAILABLE', 'Enrollment unavailable'));
      }
    });
  }
}
