export interface PublicConfig {
  appwriteEndpoint: string;
  appwriteProjectId: string;
  apiBaseUrl: string;
}

type PublicEnvironment = Record<string, string | undefined>;

export class PublicConfigError extends Error {
  constructor(variable: string, reason: string) {
    super(`Invalid public configuration: ${variable} ${reason}`);
    this.name = 'PublicConfigError';
  }
}

function requireValue(environment: PublicEnvironment, variable: string): string {
  const value = environment[variable]?.trim();
  if (!value) throw new PublicConfigError(variable, 'is required');
  return value;
}

function requireHttpsUrl(environment: PublicEnvironment, variable: string): string {
  const value = requireValue(environment, variable);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicConfigError(variable, 'must be an absolute HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new PublicConfigError(variable, 'must be an absolute HTTPS URL without credentials, query, or fragment');
  }
  return value.replace(/\/+$/, '');
}

function requireProjectId(environment: PublicEnvironment): string {
  const projectId = requireValue(environment, 'NEXT_PUBLIC_APPWRITE_PROJECT_ID');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/.test(projectId)) {
    throw new PublicConfigError('NEXT_PUBLIC_APPWRITE_PROJECT_ID', 'has an invalid format');
  }
  return projectId;
}

export function parsePublicConfig(environment: PublicEnvironment): PublicConfig {
  return {
    appwriteEndpoint: requireHttpsUrl(environment, 'NEXT_PUBLIC_APPWRITE_ENDPOINT'),
    appwriteProjectId: requireProjectId(environment),
    apiBaseUrl: requireHttpsUrl(environment, 'NEXT_PUBLIC_API_BASE_URL'),
  };
}

export function getPublicConfig(): PublicConfig {
  const rawEndpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
  const rawProjectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  return parsePublicConfig({
    NEXT_PUBLIC_APPWRITE_ENDPOINT:
      rawEndpoint && !rawEndpoint.includes('aogc088s00c4osck8k0ks0c4')
        ? rawEndpoint
        : 'https://appwrite.xpointsolucoes.com.br/v1',
    NEXT_PUBLIC_APPWRITE_PROJECT_ID:
      rawProjectId && rawProjectId !== '69db5246001f7f0ef0a9'
        ? rawProjectId
        : '6abc5640003cb361b809',
    NEXT_PUBLIC_API_BASE_URL:
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      'https://qyrjepou8xchzlfirsbrhwr9.179.199.142.157.sslip.io',
  });
}
