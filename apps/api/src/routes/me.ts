import type { FastifyInstance, preHandlerHookHandler } from 'fastify';

export function registerMeRoute(app: FastifyInstance, authenticate: preHandlerHookHandler): void {
  app.get('/v1/me', { preHandler: authenticate }, async (request) => {
    const technician = request.technician!;
    return { id: technician.userId, displayName: technician.displayName,
      globalRole: technician.globalRole, authorization: technician.authorization };
  });
}
