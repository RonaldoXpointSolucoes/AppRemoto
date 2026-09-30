import { isIP } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { HeartbeatRequestSchema, HeartbeatResponseSchema } from '@appremoto/contracts';
import { deviceTokenHashFromRequest } from '../plugins/device-auth.ts';
import { HeartbeatError, type RecordHeartbeat } from '../services/record-heartbeat.ts';

const errorBody = (code: string, message: string) => ({ error: { code, message } });

function canonicalIp(value: string): string | null {
  const version = isIP(value);
  if (!version) return null;
  if (version === 4) return value;
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(normalized);
  if (!mapped) return normalized;
  const high = parseInt(mapped[1]!, 16); const low = parseInt(mapped[2]!, 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

export function registerAgentHeartbeatRoute(app: FastifyInstance, record: RecordHeartbeat): void {
  app.post('/v1/agent/heartbeat', {
    bodyLimit: 8192,
    childLoggerFactory: (logger, bindings, options) => logger.child(bindings, {
      ...options, serializers: {
        req: (request: { method: string }) => ({ method: request.method, route: '/v1/agent/heartbeat' }),
        err: () => ({ code: 'HEARTBEAT_UNAVAILABLE' }),
      },
    }),
    errorHandler: (_error, _request, reply) => reply.code(400).send(errorBody('INVALID_HEARTBEAT', 'Invalid heartbeat')),
  }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const hash = deviceTokenHashFromRequest(request);
    if (!hash) return reply.code(401).send(errorBody('UNAUTHENTICATED', 'Authentication required'));
    const parsed = HeartbeatRequestSchema.safeParse(request.body);
    const sourceIp = canonicalIp(request.ip);
    if (!parsed.success || !sourceIp || Object.keys(request.query as object).length !== 0) {
      return reply.code(400).send(errorBody('INVALID_HEARTBEAT', 'Invalid heartbeat'));
    }
    try { return HeartbeatResponseSchema.parse(await record(hash, parsed.data, sourceIp)); }
    catch (error) {
      if (error instanceof HeartbeatError && error.code === 'UNAUTHENTICATED') {
        return reply.code(401).send(errorBody('UNAUTHENTICATED', 'Authentication required'));
      }
      if (error instanceof HeartbeatError && error.code === 'HEARTBEAT_FORBIDDEN') {
        return reply.code(403).send(errorBody('HEARTBEAT_FORBIDDEN', 'Access denied'));
      }
      request.log.warn({ code: 'HEARTBEAT_UNAVAILABLE' }, 'Heartbeat unavailable');
      return reply.code(503).send(errorBody('HEARTBEAT_UNAVAILABLE', 'Heartbeat unavailable'));
    }
  });
}
