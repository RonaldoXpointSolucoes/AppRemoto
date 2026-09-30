import { describe, expect, it } from 'vitest';

import { parsePublicConfig, PublicConfigError } from './config';
import { ApiClientError, createApiClient } from './api';

const validConfig = {
  NEXT_PUBLIC_APPWRITE_ENDPOINT: 'https://appwrite.example.com/v1',
  NEXT_PUBLIC_APPWRITE_PROJECT_ID: 'remote-project',
  NEXT_PUBLIC_API_BASE_URL: 'https://api.example.com',
};

describe('parsePublicConfig', () => {
  it.each(Object.keys(validConfig))('rejects a missing %s value', (key) => {
    const environment = { ...validConfig, [key]: '' };

    expect(() => parsePublicConfig(environment)).toThrow(PublicConfigError);
    expect(() => parsePublicConfig(environment)).toThrow(key);
  });

  it.each([
    ['NEXT_PUBLIC_APPWRITE_ENDPOINT', 'not-a-url'],
    ['NEXT_PUBLIC_APPWRITE_ENDPOINT', 'ftp://appwrite.example.com/v1'],
    ['NEXT_PUBLIC_API_BASE_URL', 'javascript:alert(1)'],
  ])('rejects invalid public URL in %s', (key, value) => {
    expect(() => parsePublicConfig({ ...validConfig, [key]: value })).toThrow(PublicConfigError);
  });

  it('rejects an invalid public Appwrite project identifier', () => {
    expect(() => parsePublicConfig({
      ...validConfig,
      NEXT_PUBLIC_APPWRITE_PROJECT_ID: 'project/with secret',
    })).toThrow(PublicConfigError);
  });

  it('normalizes URL suffixes without changing the public project identifier', () => {
    expect(parsePublicConfig({
      ...validConfig,
      NEXT_PUBLIC_APPWRITE_ENDPOINT: 'https://appwrite.example.com/v1/',
      NEXT_PUBLIC_API_BASE_URL: 'https://api.example.com/',
    })).toEqual({
      appwriteEndpoint: 'https://appwrite.example.com/v1',
      appwriteProjectId: 'remote-project',
      apiBaseUrl: 'https://api.example.com',
    });
  });
});

describe('createApiClient', () => {
  it('normalizes a valid API error without exposing unrelated response fields', async () => {
    const request = createApiClient({
      baseUrl: validConfig.NEXT_PUBLIC_API_BASE_URL,
      getJwt: async () => 'session-jwt',
      fetch: async () => new Response(JSON.stringify({ error: {
        code: 'SESSION_EXPIRED', message: 'Session expired', requestId: 'req-7', secret: 'do-not-copy',
      }, internal: 'do-not-copy-either'
      }), { status: 401, headers: { 'content-type': 'application/json' } }),
    });

    const error = await request.getMe().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: 'SESSION_EXPIRED', message: 'Session expired', requestId: 'req-7', status: 401,
    });
    expect(error).not.toHaveProperty('secret');
  });

  it('uses a stable generic error for malformed non-success responses', async () => {
    const request = createApiClient({
      baseUrl: validConfig.NEXT_PUBLIC_API_BASE_URL,
      getJwt: async () => 'session-jwt',
      fetch: async () => new Response('<html>proxy error</html>', { status: 502 }),
    });

    await expect(request.getOrganizations()).rejects.toMatchObject({
      code: 'REQUEST_FAILED', message: 'Nao foi possivel concluir a solicitacao.', status: 502,
    });
  });

  it('uses a stable network error and never includes the transport exception', async () => {
    const request = createApiClient({
      baseUrl: validConfig.NEXT_PUBLIC_API_BASE_URL,
      getJwt: async () => 'session-jwt',
      fetch: async () => { throw new Error('connect token=private-value'); },
    });

    const error = await request.getMe().catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: 'NETWORK_ERROR', message: 'Nao foi possivel conectar ao servico.', status: 0,
    });
    expect(String(error)).not.toContain('private-value');
  });
});
