import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerTechnicianAuth, type TechnicianServices } from './plugins/technician-auth.ts';
import { registerMeRoute } from './routes/me.ts';
import { registerOrganizationsRoute } from './routes/organizations.ts';

export function buildApp(options: FastifyServerOptions = {}, services?: TechnicianServices): FastifyInstance {
  const app = Fastify(options);

  app.get('/health', async () => ({ status: 'ok' }));

  if (services) {
    const authenticate = registerTechnicianAuth(app, services);
    registerMeRoute(app, authenticate);
    registerOrganizationsRoute(app, authenticate);
  }

  return app;
}
