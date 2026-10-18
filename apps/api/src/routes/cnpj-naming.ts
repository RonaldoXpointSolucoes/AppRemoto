import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AdminCnpjNamingActionRequestSchema,
  CnpjMigrationRequestSchema,
  ConfirmNameRequestSchema,
  DeviceSyncRequestSchema,
  InstallationContextRequestSchema,
  ReleaseNameRequestSchema,
  ReserveNameRequestSchema,
  SuggestNameRequestSchema,
} from '@appremoto/contracts';
import { CnpjNamingError, type CnpjNamingService } from '../services/cnpj-naming.ts';

type Authenticate = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

function extractBearerCapability(request: FastifyRequest): string | null {
  const authHeaders = request.raw.rawHeaders.filter(
    (_value, index, all) => index % 2 === 1 && all[index - 1]!.toLowerCase() === 'authorization',
  );
  if (authHeaders.length !== 1) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{32,512})$/.exec(authHeaders[0]!);
  return match?.[1] ?? null;
}

export function registerCnpjNamingRoutes(
  app: FastifyInstance,
  service: CnpjNamingService,
  authenticate: Authenticate,
): void {
  const options = {
    bodyLimit: 16384,
    onRequest: async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.header('cache-control', 'no-store');
    },
  };
  const operator = { ...options, preHandler: authenticate };
  const invalid = (reply: FastifyReply, detail = 'Invalid request') =>
    reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: detail } });

  async function perform(reply: FastifyReply, action: () => Promise<unknown>) {
    try {
      return await action();
    } catch (error) {
      if (error instanceof CnpjNamingError) {
        return reply
          .code(error.statusCode)
          .send({ error: { code: error.code, message: error.message } });
      }
      return reply
        .code(503)
        .send({ error: { code: 'NAMING_UNAVAILABLE', message: 'Naming service unavailable' } });
    }
  }

  app.post('/v1/agent/installation/context', options, async (request, reply) => {
    const capability = extractBearerCapability(request);
    if (!capability) {
      return reply
        .code(403)
        .send({ error: { code: 'NAMING_ACCESS_DENIED', message: 'Access denied' } });
    }
    const body = InstallationContextRequestSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    return perform(reply, () => service.getInstallationContext(capability, body.data, request.ip));
  });

  app.post('/v1/agent/installation/suggest-name', options, async (request, reply) => {
    const capability = extractBearerCapability(request);
    if (!capability) {
      return reply
        .code(403)
        .send({ error: { code: 'NAMING_ACCESS_DENIED', message: 'Access denied' } });
    }
    const body = SuggestNameRequestSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    return perform(reply, () => service.suggestName(capability, null, body.data));
  });

  app.post('/v1/agent/installation/reserve-name', options, async (request, reply) => {
    const capability = extractBearerCapability(request);
    if (!capability) {
      return reply
        .code(403)
        .send({ error: { code: 'NAMING_ACCESS_DENIED', message: 'Access denied' } });
    }
    const body = ReserveNameRequestSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    return perform(reply, () => service.reserveName(capability, body.data, request.ip));
  });

  app.post('/v1/agent/installation/confirm-name', options, async (request, reply) => {
    const capability = extractBearerCapability(request);
    const body = ConfirmNameRequestSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    return perform(reply, () => service.confirmName(capability, body.data, request.ip));
  });

  app.post('/v1/agent/installation/release-name', options, async (request, reply) => {
    const capability = extractBearerCapability(request);
    const body = ReleaseNameRequestSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    return perform(reply, () => service.releaseName(capability, null, body.data, request.ip));
  });

  app.post('/v1/agent/device/sync', options, async (request, reply) => {
    const body = DeviceSyncRequestSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    return perform(reply, () => service.syncDevice(body.data, request.ip));
  });

  app.get('/v1/cnpj-groups', operator, async (request, reply) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const cnpjFilter = typeof query.cnpj === 'string' ? query.cnpj : undefined;
    return perform(reply, () => service.listCnpjGroups(request.technician!, cnpjFilter));
  });

  app.post('/v1/cnpj-groups/suggest-name', operator, async (request, reply) => {
    const body = SuggestNameRequestSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    return perform(reply, () => service.suggestName(null, request.technician!, body.data));
  });

  app.post('/v1/cnpj-groups/action', operator, async (request, reply) => {
    const body = AdminCnpjNamingActionRequestSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    return perform(reply, () => service.adminAction(request.technician!, body.data, request.ip));
  });

  app.post('/v1/cnpj-groups/migrate', operator, async (request, reply) => {
    const body = CnpjMigrationRequestSchema.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply);
    return perform(reply, () =>
      service.migrateExistingDevices(request.technician!, body.data, request.ip),
    );
  });
}
