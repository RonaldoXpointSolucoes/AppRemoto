import { ApiErrorSchema, type DeviceListQuery, type DeviceView } from '@appremoto/contracts';

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
  const request = async <T>(path: string): Promise<T> => {
    let response: Response;
    try {
      const jwt = await options.getJwt();
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
    return body as T;
  };

  return {
    getMe: () => request<TechnicianView>('/v1/me'),
    getOrganizations: async () => (await request<{ organizations: OrganizationView[] }>('/v1/organizations')).organizations,
    getDevices: (query: DeviceListQuery = { limit: 50 }) => {
      const params = new URLSearchParams();
      if (query.organizationId) params.set('organizationId', query.organizationId);
      if (query.status) params.set('status', query.status);
      if (query.search) params.set('search', query.search);
      if (query.cursor) params.set('cursor', query.cursor);
      params.set('limit', String(query.limit));
      return request<DevicePage>(`/v1/devices?${params.toString()}`);
    },
  };
}
