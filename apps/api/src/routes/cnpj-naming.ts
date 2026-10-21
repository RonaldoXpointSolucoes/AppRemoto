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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
    const raw = asRecord(request.body);
    const isGoAgent = typeof raw.installerId !== 'string';
    const candidate = isGoAgent
      ? {
          installerId: 'auto',
          cnpj: raw.cnpj,
          ...(typeof raw.razaoSocial === 'string' && raw.razaoSocial ? { razaoSocial: raw.razaoSocial } : {}),
          ...(typeof raw.nomeFantasia === 'string' && raw.nomeFantasia ? { nomeFantasia: raw.nomeFantasia } : {}),
          ...(typeof raw.serial === 'string' && raw.serial ? { serial: raw.serial } : {}),
          ...(typeof raw.deviceUuid === 'string' && raw.deviceUuid ? { deviceUuid: raw.deviceUuid } : {}),
          ...(typeof raw.rustdeskId === 'string' && raw.rustdeskId ? { rustdeskId: raw.rustdeskId } : {}),
          ...(typeof (raw.currentWindowsHostname ?? raw.windowsHostnameAtual) === 'string' &&
          (raw.currentWindowsHostname ?? raw.windowsHostnameAtual)
            ? { currentWindowsHostname: (raw.currentWindowsHostname ?? raw.windowsHostnameAtual) as string }
            : {}),
        }
      : request.body;
    const body = InstallationContextRequestSchema.safeParse(candidate);
    if (!body.success) return invalid(reply);
    return perform(reply, async () => {
      const result = await service.getInstallationContext(capability, body.data, request.ip);
      if (!isGoAgent) return result;
      const goComputers = result.computers.map((c) => ({
        ...c,
        organizationId: result.groupId,
        nome: c.displayName,
        nomeNormalizado: c.windowsHostnameDesejado || c.displayName,
        funcao: c.role,
        funcaoLabel: c.roleLabel,
        situacao:
          c.status === 'ONLINE'
            ? 'online'
            : c.status === 'OFFLINE'
              ? 'offline'
              : c.status === 'RESERVED'
                ? 'reservado'
                : 'substituido',
        statusRenomeacao: c.renameStatus,
        ...(c.windowsHostnameDesejado ? { windowsHostnameDesejado: c.windowsHostnameDesejado } : {}),
        ...(c.lastSeenAt ? { lastSeenAt: c.lastSeenAt } : {}),
      }));
      const onlineCount = result.computers.filter((c) => c.status === 'ONLINE').length;
      const offlineCount = result.computers.filter((c) => c.status === 'OFFLINE').length;
      const existingDevice = goComputers.find((c) => c.deviceId === result.matchedDeviceId) ?? null;
      return {
        ...result,
        group: {
          organizationId: result.groupId,
          cnpj: result.cnpj,
          cnpjFormatado: result.formattedCnpj,
          razaoSocial: result.razaoSocial ?? result.organizationName,
          nomeFantasia: result.nomeFantasia ?? result.organizationName,
          status: 'ativo',
          totalComputadores: result.totalComputers,
          onlineCount,
          offlineCount,
        },
        computers: goComputers,
        detectedOperation: result.operationMode,
        existingDevice,
        defaultRole: result.recommendedRole,
        defaultSuggestion: {
          suggestedName: result.recommendedName,
          normalizedName: result.recommendedName,
          role: result.recommendedRole,
          roleLabel:
            result.catalog.find((r) => r.code === result.recommendedRole)?.label ??
            result.recommendedRole,
          available: true,
          reason: result.recommendationExplanation,
          occupiedNumbers: [],
          occupiedNames: [],
        },
        serverTime: new Date().toISOString(),
      };
    });
  });

  app.post('/v1/agent/installation/suggest-name', options, async (request, reply) => {
    const capability = extractBearerCapability(request);
    if (!capability) {
      return reply
        .code(403)
        .send({ error: { code: 'NAMING_ACCESS_DENIED', message: 'Access denied' } });
    }
    const raw = asRecord(request.body);
    const isGoAgent = typeof raw.installerId !== 'string';
    const candidate = isGoAgent
      ? {
          installerId: 'auto',
          cnpj: raw.cnpj,
          role: raw.role,
          ...(typeof raw.customName === 'string' && raw.customName ? { customName: raw.customName } : {}),
          ...(typeof raw.deviceUuid === 'string' && raw.deviceUuid ? { deviceUuid: raw.deviceUuid } : {}),
          ...(typeof (raw.replaceDeviceId ?? raw.replacesDeviceId) === 'string' &&
          (raw.replaceDeviceId ?? raw.replacesDeviceId)
            ? { replaceDeviceId: (raw.replaceDeviceId ?? raw.replacesDeviceId) as string }
            : {}),
        }
      : request.body;
    const body = SuggestNameRequestSchema.safeParse(candidate);
    if (!body.success) return invalid(reply);
    return perform(reply, async () => {
      const result = await service.suggestName(capability, null, body.data);
      if (!isGoAgent) return result;
      return {
        ...result,
        normalizedName: result.suggestedName,
        reason: result.explanation,
        occupiedNumbers: [],
        occupiedNames: [],
      };
    });
  });

  app.post('/v1/agent/installation/reserve-name', options, async (request, reply) => {
    const capability = extractBearerCapability(request);
    if (!capability) {
      return reply
        .code(403)
        .send({ error: { code: 'NAMING_ACCESS_DENIED', message: 'Access denied' } });
    }
    const raw = asRecord(request.body);
    const isGoAgent = typeof raw.installerId !== 'string';
    const candidate = isGoAgent
      ? {
          installerId: 'auto',
          cnpj: raw.cnpj,
          ...(typeof raw.razaoSocial === 'string' && raw.razaoSocial ? { razaoSocial: raw.razaoSocial } : {}),
          ...(typeof raw.nomeFantasia === 'string' && raw.nomeFantasia ? { nomeFantasia: raw.nomeFantasia } : {}),
          ...(typeof raw.serial === 'string' && raw.serial ? { serial: raw.serial } : {}),
          role: raw.role,
          desiredName: raw.desiredName ?? raw.normalizedName,
          ...(typeof raw.deviceUuid === 'string' && raw.deviceUuid ? { deviceUuid: raw.deviceUuid } : {}),
          ...(typeof raw.rustdeskId === 'string' && raw.rustdeskId ? { rustdeskId: raw.rustdeskId } : {}),
          ...(typeof (raw.currentWindowsHostname ?? raw.windowsHostnameAtual) === 'string' &&
          (raw.currentWindowsHostname ?? raw.windowsHostnameAtual)
            ? { currentWindowsHostname: (raw.currentWindowsHostname ?? raw.windowsHostnameAtual) as string }
            : {}),
          ...(typeof raw.operationMode === 'string' && raw.operationMode ? { operationMode: raw.operationMode } : {}),
          ...(typeof (raw.replaceDeviceId ?? raw.replacesDeviceId) === 'string' &&
          (raw.replaceDeviceId ?? raw.replacesDeviceId)
            ? { replaceDeviceId: (raw.replaceDeviceId ?? raw.replacesDeviceId) as string }
            : {}),
        }
      : request.body;
    const body = ReserveNameRequestSchema.safeParse(candidate);
    if (!body.success) return invalid(reply);
    return perform(reply, async () => {
      const result = await service.reserveName(capability, body.data, request.ip);
      if (!isGoAgent) return result;
      if (!result.reserved) {
        return reply
          .code(409)
          .send({ error: { code: 'NAME_ALREADY_IN_USE', message: result.explanation } });
      }
      return {
        ...result,
        organizationId: result.groupId,
      };
    });
  });

  app.post('/v1/agent/installation/confirm-name', options, async (request, reply) => {
    const capability = extractBearerCapability(request);
    const raw = asRecord(request.body);
    const isGoAgent = typeof raw.installerId !== 'string' && typeof raw.actualWindowsHostname !== 'string';
    const statusStr = typeof raw.statusRenomeacao === 'string' ? raw.statusRenomeacao : '';
    const candidate = isGoAgent
      ? {
          ...(capability ? { installerId: 'auto' } : {}),
          cnpj: raw.cnpj,
          deviceUuid: raw.deviceUuid,
          ...(typeof raw.reservationId === 'string' && raw.reservationId ? { reservationId: raw.reservationId } : {}),
          desiredName: raw.desiredName ?? raw.windowsHostnameDesejado ?? raw.normalizedName,
          actualWindowsHostname: raw.actualWindowsHostname ?? raw.windowsHostnameAtual,
          ...(typeof raw.role === 'string' && raw.role ? { role: raw.role } : {}),
          renameApplied: statusStr === 'CONFIRMADO' || statusStr === 'APLICADO_AGUARDANDO_REBOOT',
          rebootRequired: statusStr === 'APLICADO_AGUARDANDO_REBOOT',
          ...(typeof raw.erroRenomeacao === 'string' && raw.erroRenomeacao ? { errorDetail: raw.erroRenomeacao } : {}),
        }
      : request.body;
    const body = ConfirmNameRequestSchema.safeParse(candidate);
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
