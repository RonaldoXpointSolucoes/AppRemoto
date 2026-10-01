import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { CreateEnrollmentTokenRequestSchema, EnrollmentStatusParamsSchema, ConnectDeviceParamsSchema } from '@appremoto/contracts';
import { OperatorSetupDenied, type OperatorSetupService } from '../services/operator-setup.ts';

type Authenticate = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export function registerSetupRoutes(app: FastifyInstance, authenticate: Authenticate, service: OperatorSetupService): void {
  const options = {
    bodyLimit: 4096,
    onRequest: async (_request: FastifyRequest, reply: FastifyReply) => { reply.header('cache-control', 'no-store'); },
    preHandler: authenticate,
  };
  const invalid = (reply: FastifyReply) => reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: 'Invalid request' } });
  async function perform(reply: FastifyReply, action: () => Promise<unknown>) {
    try { return await action(); }
    catch (error) {
      const denied = error instanceof OperatorSetupDenied;
      return reply.code(denied ? 403 : 503).send({ error: { code: denied ? 'ACCESS_DENIED' : 'SETUP_UNAVAILABLE',
        message: denied ? 'Access denied' : 'Setup unavailable' } });
    }
  }
  app.post('/v1/enrollment-tokens', options, async (request, reply) => {
    const body = CreateEnrollmentTokenRequestSchema.safeParse(request.body);
    if (!body.success || Object.keys(request.query as object).length) return invalid(reply);
    return perform(reply, async () => { const result = await service.create(request.technician!, body.data, request.ip);
      reply.code(201); return result; });
  });
  app.get('/v1/enrollment-tokens/:enrollmentId/status', options, async (request, reply) => {
    const params = EnrollmentStatusParamsSchema.safeParse(request.params);
    if (!params.success || Object.keys(request.query as object).length) return invalid(reply);
    return perform(reply, () => service.status(request.technician!, params.data.enrollmentId));
  });
  app.post('/v1/devices/:deviceId/connect', options, async (request, reply) => {
    const params = ConnectDeviceParamsSchema.safeParse(request.params);
    if (!params.success || Object.keys(request.query as object).length ||
      (request.body !== undefined && (request.body === null || typeof request.body !== 'object' ||
      Array.isArray(request.body) || Object.keys(request.body).length))) return invalid(reply);
    return perform(reply, () => service.connect(request.technician!, params.data.deviceId, request.ip));
  });
}
