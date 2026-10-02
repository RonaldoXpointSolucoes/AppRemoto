import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CreateGenericInstallerRequestSchema, GenericInstallerParamsSchema, PrepareInstallationRequestSchema } from '@appremoto/contracts';
import { GenericInstallerError, type GenericInstallerService } from '../services/generic-installers.ts';
type Authenticate = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export function registerGenericInstallerRoutes(app: FastifyInstance, service: GenericInstallerService, authenticate: Authenticate): void {
  const options = { bodyLimit: 4096,
    onRequest: async (_request: FastifyRequest, reply: FastifyReply) => { reply.header('cache-control', 'no-store'); } };
  const operator = { ...options, preHandler: authenticate };
  const empty = (body: unknown) => body === undefined || body !== null && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0;
  const invalid = (reply: FastifyReply) => reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: 'Invalid request' } });
  async function perform(reply: FastifyReply, action: () => Promise<unknown>) {
    try { return await action(); }
    catch (error) {
      const failure = error instanceof GenericInstallerError ? error : new GenericInstallerError('GENERIC_INSTALLER_UNAVAILABLE');
      return reply.code(failure.statusCode).send({ error: { code: failure.code, message: 'Generic installer operation unavailable' } });
    }
  }
  app.get('/v1/generic-installers', operator, async (request, reply) => {
    if (Object.keys(request.query as object).length) return invalid(reply);
    return perform(reply, () => service.list(request.technician!));
  });
  app.post('/v1/generic-installers', operator, async (request, reply) => {
    const body = CreateGenericInstallerRequestSchema.safeParse(request.body);
    if (!body.success || Object.keys(request.query as object).length) return invalid(reply);
    return perform(reply, async () => { const result = await service.create(request.technician!, body.data); reply.code(201); return result; });
  });
  for (const action of ['package', 'revoke'] as const) app.post(`/v1/generic-installers/:installerId/${action}`, operator, async (request, reply) => {
    const params = GenericInstallerParamsSchema.safeParse(request.params);
    if (!params.success || !empty(request.body) || Object.keys(request.query as object).length) return invalid(reply);
    return perform(reply, () => action === 'package' ? service.download(request.technician!, params.data.installerId) : service.revoke(request.technician!, params.data.installerId));
  });
  const buckets = new Map<string, { expires: number; count: number }>();
  app.post('/v1/agent/prepare-installation', options, async (request, reply) => {
    const body = PrepareInstallationRequestSchema.safeParse(request.body);
    const authHeaders = request.raw.rawHeaders.filter((_value, index, all) => index % 2 === 1 && all[index - 1]!.toLowerCase() === 'authorization');
    const capability = authHeaders.length === 1 ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authHeaders[0]!)?.[1] : undefined;
    if (!capability) return reply.code(403).send({ error: { code: 'GENERIC_INSTALLER_DENIED', message: 'Access denied' } });
    if (!body.success || Object.keys(request.query as object).length) return invalid(reply);
    const now = Date.now(); for (const [ip, bucket] of buckets) if (bucket.expires <= now) buckets.delete(ip);
    let bucket = buckets.get(request.ip);
    if (bucket && bucket.count >= 20 || !bucket && buckets.size >= 10_000) {
      return reply.code(429).send({ error: { code: 'GENERIC_INSTALLER_RATE_LIMITED', message: 'Try again later' } });
    }
    if (!bucket) { bucket = { expires: now + 60_000, count: 0 }; buckets.set(request.ip, bucket); }
    bucket.count++;
    return perform(reply, () => service.prepare(capability, body.data, request.ip));
  });
}
