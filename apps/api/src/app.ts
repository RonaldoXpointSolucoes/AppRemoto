import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import { registerTechnicianAuth, type TechnicianServices } from './plugins/technician-auth.ts';
import { registerMeRoute } from './routes/me.ts';
import { registerOrganizationsRoute } from './routes/organizations.ts';
import { registerDevicesRoute } from './routes/devices.ts';

export function buildApp(options: FastifyServerOptions = {}, services?: TechnicianServices,
  allowedOrigins?: string[]): FastifyInstance {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } }, ...options });

  if (allowedOrigins) app.register(cors, {
    origin: (origin, callback) => callback(null, Boolean(origin && allowedOrigins.includes(origin))),
    methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type'],
    strictPreflight: true,
  });

  app.get('/health', async () => ({ status: 'ok' }));

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
