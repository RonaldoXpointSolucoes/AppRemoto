import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { CreateEnrollmentTokenRequestSchema, EnrollmentStatusParamsSchema, ConnectDeviceParamsSchema,
  ConnectDeviceRequestSchema, UpdateDeviceRequestSchema, ConnectionEventRequestSchema } from '@appremoto/contracts';
import { OperatorSetupDenied, type OperatorSetupService } from '../services/operator-setup.ts';
import { DeviceToolError } from '../services/operator-errors.ts';

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
      if (error instanceof DeviceToolError) return reply.code(error.statusCode).send({ error: {
        code: error.code, message: 'Device operation unavailable' } });
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
    if (!params.success || Object.keys(request.query as object).length) return invalid(reply);
    const legacy = request.body === undefined || (request.body !== null && typeof request.body === 'object' &&
      !Array.isArray(request.body) && Object.keys(request.body).length === 0);
    if (legacy) return perform(reply, () => service.connect(request.technician!, params.data.deviceId, request.ip));
    const body = ConnectDeviceRequestSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    return perform(reply, async () => {
      if (!service.connectWithOptions) throw new Error();
      return service.connectWithOptions(request.technician!, params.data.deviceId, body.data, request.ip);
    });
  });
  app.get('/v1/devices/:deviceId/details', options, async (request, reply) => {
    const params = ConnectDeviceParamsSchema.safeParse(request.params);
    if (!params.success || Object.keys(request.query as object).length) return invalid(reply);
    return perform(reply, async () => {
      if (!service.details) throw new Error();
      return service.details(request.technician!, params.data.deviceId);
    });
  });
  app.post('/v1/devices/:deviceId/update', { ...options, bodyLimit: 16_384 }, async (request, reply) => {
    const params = ConnectDeviceParamsSchema.safeParse(request.params);
    const body = UpdateDeviceRequestSchema.safeParse(request.body);
    if (!params.success || !body.success || Object.keys(request.query as object).length) return invalid(reply);
    return perform(reply, async () => {
      if (!service.update) throw new Error();
      return service.update(request.technician!, params.data.deviceId, body.data, request.ip);
    });
  });
  app.get('/v1/devices/:deviceId/connection-history', options, async (request, reply) => {
    const params = ConnectDeviceParamsSchema.safeParse(request.params);
    if (!params.success || Object.keys(request.query as object).length) return invalid(reply);
    return perform(reply, async () => {
      if (!service.connectionHistory) throw new Error();
      return service.connectionHistory(request.technician!, params.data.deviceId);
    });
  });
  app.post('/v1/devices/:deviceId/connection-events', options, async (request, reply) => {
    const params = ConnectDeviceParamsSchema.safeParse(request.params);
    const body = ConnectionEventRequestSchema.safeParse(request.body);
    if (!params.success || !body.success || Object.keys(request.query as object).length) return invalid(reply);
    return perform(reply, async () => {
      if (!service.connectionEvent) throw new Error();
      return service.connectionEvent(request.technician!, params.data.deviceId, body.data, request.ip);
    });
  });
}
