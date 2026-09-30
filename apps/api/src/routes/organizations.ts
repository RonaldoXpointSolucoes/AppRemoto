import type { FastifyInstance, preHandlerHookHandler } from 'fastify';

export function registerOrganizationsRoute(app: FastifyInstance, authenticate: preHandlerHookHandler): void {
  app.get('/v1/organizations', { preHandler: authenticate,
    schema: { querystring: { type: 'object', properties: {}, additionalProperties: false } },
  }, async (request) => ({
    organizations: request.technician!.organizations.map(({ id, name, slug }) => ({ id, name, slug })),
  }));
}
