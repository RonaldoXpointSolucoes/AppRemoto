import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import { registerTechnicianAuth, type TechnicianServices } from './plugins/technician-auth.ts';
import { registerMeRoute } from './routes/me.ts';
import { registerOrganizationsRoute } from './routes/organizations.ts';
import { registerDevicesRoute } from './routes/devices.ts';
import { registerAgentEnrollRoute } from './routes/agent-enroll.ts';
import { registerAgentHeartbeatRoute } from './routes/agent-heartbeat.ts';

export function buildApp(options: FastifyServerOptions = {}, services?: TechnicianServices,
  allowedOrigins?: string[]): FastifyInstance {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } }, ...options,
    childLoggerFactory: (logger, bindings, childOptions) => logger.child(bindings, {
      ...childOptions, serializers: {
        req: (request: { method: string }) => ({ method: request.method }),
        err: () => ({ code: 'REQUEST_FAILED' }),
        res: (reply: { statusCode: number }) => ({ statusCode: reply.statusCode }),
      },
    }),
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.setErrorHandler((error, request, reply) => {
    request.log.warn({ code: 'REQUEST_FAILED' }, 'Request failed');
    const status = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' &&
      error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    return reply.code(status).send({ error: { code: 'REQUEST_FAILED', message: 'Request failed' } });
  });

  if (allowedOrigins) app.register(cors, {
    origin: (origin, callback) => callback(null, Boolean(origin && allowedOrigins.includes(origin))),
    methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type'],
    strictPreflight: true,
  });

  app.get('/health', async () => ({ status: 'ok' }));
  if (services?.enrollDevice) registerAgentEnrollRoute(app, services.enrollDevice);
  if (services?.recordHeartbeat) registerAgentHeartbeatRoute(app, services.recordHeartbeat);

  if (services) {
    const authenticate = registerTechnicianAuth(app, services);
    registerMeRoute(app, authenticate);
    registerOrganizationsRoute(app, authenticate);
    if (services.devices && services.cursorSecret) {
      registerDevicesRoute(app, authenticate, services.devices, services.cursorSecret, services.now);
    }
  }

  return app;
}
