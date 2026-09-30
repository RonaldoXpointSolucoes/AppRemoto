import { ApiErrorSchema, DeviceViewSchema, type DeviceListQuery, type DeviceView } from '@appremoto/contracts';
import { AppwriteException } from 'appwrite';
import { z, type ZodType } from 'zod';

export interface OrganizationView {
  id: string;
  name: string;
  slug: string;
}

export interface OrganizationAuthorization {
  organizationId: string;
  role: string;
  canView: boolean;
  canConnect: boolean;
  canManageDevices: boolean;
}

export interface TechnicianView {
  id: string;
  displayName: string;
  globalRole: string | null;
  authorization: OrganizationAuthorization[];
}

export interface DevicePage {
  devices: DeviceView[];
  nextCursor: string | null;
}

const OrganizationViewSchema = z.object({
  id: z.string().min(1).max(36),
  name: z.string().min(1).max(128),
  slug: z.string().min(1).max(128),
}).strict();

const OrganizationAuthorizationSchema = z.object({
  organizationId: z.string().min(1).max(36),
  role: z.string().min(1).max(64),
  canView: z.boolean(),
  canConnect: z.boolean(),
  canManageDevices: z.boolean(),
}).strict();

const TechnicianViewSchema = z.object({
  id: z.string().min(1).max(36),
  displayName: z.string().min(1).max(128),
  globalRole: z.string().min(1).max(64).nullable(),
  authorization: z.array(OrganizationAuthorizationSchema),
}).strict();

const OrganizationsResponseSchema = z.object({
  organizations: z.array(OrganizationViewSchema),
}).strict();

const DevicePageSchema = z.object({
  devices: z.array(DeviceViewSchema),
  nextCursor: z.string().min(1).max(1024).nullable(),
}).strict();

interface ApiClientOptions {
  baseUrl: string;
  getJwt: () => Promise<string>;
  fetch?: typeof globalThis.fetch;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;

  constructor(input: { code: string; message: string; status: number; requestId?: string }) {
    super(input.message);
    this.name = 'ApiClientError';
    this.code = input.code;
    this.status = input.status;
    this.requestId = input.requestId;
  }
}

function normalizedError(body: unknown, status: number): ApiClientError {
  const candidate = typeof body === 'object' && body !== null && 'error' in body
    ? (body as { error?: unknown }).error
    : body;
  const safeCandidate = typeof candidate === 'object' && candidate !== null
    ? {
        code: (candidate as { code?: unknown }).code,
        message: (candidate as { message?: unknown }).message,
        requestId: (candidate as { requestId?: unknown }).requestId,
      }
    : candidate;
  const parsed = ApiErrorSchema.safeParse(safeCandidate);
  if (parsed.success) return new ApiClientError({ ...parsed.data, status });
  return new ApiClientError({
    code: 'REQUEST_FAILED',
    message: 'Nao foi possivel concluir a solicitacao.',
    status,
  });
}

function invalidApiResponse(): ApiClientError {
  return new ApiClientError({
    code: 'INVALID_API_RESPONSE',
    message: 'O servico retornou uma resposta invalida.',
    status: 502,
  });
}

async function responseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function createApiClient(options: ApiClientOptions) {
  const request = async <T>(path: string, schema: ZodType<T>): Promise<T> => {
    let jwt: string;
    try {
      jwt = await options.getJwt();
    } catch (error) {
      if (error instanceof AppwriteException && error.code === 401) {
        throw new ApiClientError({
          code: 'SESSION_EXPIRED',
          message: 'Sessao expirada.',
          status: 401,
        });
      }
      throw new ApiClientError({
        code: 'NETWORK_ERROR',
        message: 'Nao foi possivel conectar ao servico.',
        status: 0,
      });
    }

    let response: Response;
    try {
      response = await (options.fetch ?? globalThis.fetch)(`${options.baseUrl}${path}`, {
        headers: { authorization: `Bearer ${jwt}`, accept: 'application/json' },
        method: 'GET',
      });
    } catch {
      throw new ApiClientError({
        code: 'NETWORK_ERROR',
        message: 'Nao foi possivel conectar ao servico.',
        status: 0,
      });
    }

    const body = await responseBody(response);
    if (!response.ok) throw normalizedError(body, response.status);
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw invalidApiResponse();
    return parsed.data;
  };

  return {
    getMe: () => request('/v1/me', TechnicianViewSchema),
    getOrganizations: async () => (await request('/v1/organizations', OrganizationsResponseSchema)).organizations,
    getDevices: (query: DeviceListQuery = { limit: 50 }) => {
      const params = new URLSearchParams();
      if (query.organizationId) params.set('organizationId', query.organizationId);
      if (query.status) params.set('status', query.status);
      if (query.search) params.set('search', query.search);
      if (query.cursor) params.set('cursor', query.cursor);
      params.set('limit', String(query.limit));
      return request(`/v1/devices?${params.toString()}`, DevicePageSchema);
    },
  };
}
