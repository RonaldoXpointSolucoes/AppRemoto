import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SystemDiagnosticsService } from '../services/system-diagnostics.ts';

type PreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

export function registerDiagnosticsRoutes(
  app: FastifyInstance,
  authenticate: PreHandler,
  diagnostics: SystemDiagnosticsService,
): void {
  app.get(
    '/v1/diagnostics/telemetry',
    { preHandler: authenticate },
    async (request, reply) => {
      if (!request.technician) {
        return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
      }
      const telemetry = await diagnostics.getTelemetry();
      return reply.header('Cache-Control', 'no-store').code(200).send(telemetry);
    },
  );

  app.post(
    '/v1/diagnostics/self-heal',
    { preHandler: authenticate },
    async (request, reply) => {
      if (!request.technician) {
        return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
      }
      const result = await diagnostics.runSelfHeal();
      return reply.header('Cache-Control', 'no-store').code(200).send(result);
    },
  );
}
