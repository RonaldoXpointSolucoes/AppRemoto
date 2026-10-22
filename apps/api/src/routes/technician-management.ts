import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import {
  TechnicianAuthActionError,
  type TechnicianManagementService,
} from '../services/technician-management.ts';

export function registerTechnicianManagementRoutes(
  app: FastifyInstance,
  service: TechnicianManagementService,
  authenticate: preHandlerHookHandler
): void {
  // Public endpoint: Login automático com Google / E-mail Liberado na lista de Técnicos
  app.post(
    '/v1/auth/google-session',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 256 },
            inviteToken: { type: 'string', maxLength: 128 },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { email: string; inviteToken?: string };
      try {
        const result = await service.createAuthorizedGoogleOrInviteSession(body);
        return reply.code(200).send(result);
      } catch (err) {
        if (err instanceof TechnicianAuthActionError) {
          return reply.code(err.statusCode).send({
            error: { code: err.code, message: err.message },
          });
        }
        return reply.code(503).send({
          error: {
            code: 'AUTH_SERVICE_UNAVAILABLE',
            message: 'Não foi possível validar o acesso agora. Tente novamente.',
          },
        });
      }
    }
  );

  // Public endpoint: Ativação de convite e cadastro/definição de senha do técnico liberado
  app.post(
    '/v1/auth/activate-invite',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 256 },
            password: { type: 'string', minLength: 1, maxLength: 256 },
            displayName: { type: 'string', maxLength: 128 },
            inviteToken: { type: 'string', maxLength: 128 },
            requireUnconfiguredOrToken: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        email: string;
        password: string;
        displayName?: string;
        inviteToken?: string;
        requireUnconfiguredOrToken?: boolean;
      };
      try {
        const result = await service.activateInviteWithPassword(body);
        return reply.code(200).send(result);
      } catch (err) {
        if (err instanceof TechnicianAuthActionError) {
          return reply.code(err.statusCode).send({
            error: { code: err.code, message: err.message },
          });
        }
        return reply.code(503).send({
          error: {
            code: 'AUTH_SERVICE_UNAVAILABLE',
            message: 'Não foi possível concluir o cadastro agora. Tente novamente.',
          },
        });
      }
    }
  );

  // Authenticated: Lista todos os técnicos e convites do banco Appwrite
  app.get(
    '/v1/technicians',
    {
      preHandler: authenticate,
      schema: {
        querystring: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    },
    async (_request, reply) => {
      try {
        const data = await service.listTechnicians();
        return reply.code(200).send(data);
      } catch (err) {
        if (err instanceof TechnicianAuthActionError) {
          return reply.code(err.statusCode).send({
            error: { code: err.code, message: err.message },
          });
        }
        return reply.code(503).send({
          error: {
            code: 'TECHNICIAN_LIST_UNAVAILABLE',
            message: 'Não foi possível carregar a lista de técnicos.',
          },
        });
      }
    }
  );

  // Authenticated: Cria ou atualiza um técnico na lista liberada e gera convite
  app.post(
    '/v1/technicians',
    {
      preHandler: authenticate,
      schema: {
        body: {
          type: 'object',
          required: ['displayName', 'email', 'role'],
          additionalProperties: false,
          properties: {
            displayName: { type: 'string', minLength: 1, maxLength: 128 },
            email: { type: 'string', minLength: 3, maxLength: 256 },
            role: { type: 'string', enum: ['super_admin', 'technician'] },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        displayName: string;
        email: string;
        role: 'super_admin' | 'technician';
      };
      try {
        const result = await service.upsertTechnicianWithInvite({
          ...body,
          invitedBy: request.technician?.displayName || 'Admin',
        });
        return reply.code(200).send(result);
      } catch (err) {
        if (err instanceof TechnicianAuthActionError) {
          return reply.code(err.statusCode).send({
            error: { code: err.code, message: err.message },
          });
        }
        return reply.code(503).send({
          error: {
            code: 'TECHNICIAN_CREATE_FAILED',
            message: 'Não foi possível salvar o técnico no servidor.',
          },
        });
      }
    }
  );

  // Authenticated: Alterna status Ativo/Desativado do técnico no banco
  app.post(
    '/v1/technicians/toggle-active',
    {
      preHandler: authenticate,
      schema: {
        body: {
          type: 'object',
          required: ['userId'],
          additionalProperties: false,
          properties: {
            userId: { type: 'string', minLength: 1, maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { userId: string };
      try {
        const result = await service.toggleTechnicianActive(body.userId);
        return reply.code(200).send(result);
      } catch (err) {
        if (err instanceof TechnicianAuthActionError) {
          return reply.code(err.statusCode).send({
            error: { code: err.code, message: err.message },
          });
        }
        return reply.code(503).send({
          error: {
            code: 'TECHNICIAN_TOGGLE_FAILED',
            message: 'Não foi possível alterar o status do técnico.',
          },
        });
      }
    }
  );

  // Authenticated: Remove um técnico da lista liberada
  app.post(
    '/v1/technicians/delete',
    {
      preHandler: authenticate,
      schema: {
        body: {
          type: 'object',
          required: ['userId'],
          additionalProperties: false,
          properties: {
            userId: { type: 'string', minLength: 1, maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { userId: string };
      try {
        const result = await service.deleteTechnician(body.userId);
        return reply.code(200).send(result);
      } catch (err) {
        if (err instanceof TechnicianAuthActionError) {
          return reply.code(err.statusCode).send({
            error: { code: err.code, message: err.message },
          });
        }
        return reply.code(503).send({
          error: {
            code: 'TECHNICIAN_DELETE_FAILED',
            message: 'Não foi possível remover o técnico.',
          },
        });
      }
    }
  );

  // Authenticated: Lista os últimos acessos remotos realizados no sistema
  app.get(
    '/v1/recent-accesses',
    {
      preHandler: authenticate,
      schema: {
        querystring: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    },
    async (_request, reply) => {
      try {
        if (!service.listRecentAccesses) {
          return reply.code(200).send({ accesses: [] });
        }
        const data = await service.listRecentAccesses();
        return reply.code(200).send(data);
      } catch {
        return reply.code(200).send({ accesses: [] });
      }
    }
  );
}
