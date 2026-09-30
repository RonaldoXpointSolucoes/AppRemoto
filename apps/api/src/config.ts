export interface ApiConfig {
  appwriteEndpoint: string;
  appwriteProjectId: string;
  appwriteApiKey: string;
  masterEncryptionKey: Buffer;
  allowedOrigins: string[];
  port: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function readApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const appwriteEndpoint = required(env, 'APPWRITE_ENDPOINT');
  if (!URL.canParse(appwriteEndpoint) || new URL(appwriteEndpoint).protocol !== 'https:') {
    throw new Error('APPWRITE_ENDPOINT must be an HTTPS URL');
  }

  const appwriteProjectId = required(env, 'APPWRITE_PROJECT_ID');
  const appwriteApiKey = required(env, 'APPWRITE_API_KEY');
  const encodedKey = required(env, 'MASTER_ENCRYPTION_KEY');
  const masterEncryptionKey = Buffer.from(encodedKey, 'base64');
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey) || masterEncryptionKey.length !== 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }

  const allowedOrigins = required(env, 'ALLOWED_ORIGINS').split(',').map((origin) => origin.trim());
  if (allowedOrigins.some((origin) => !URL.canParse(origin) ||
      new URL(origin).protocol !== 'https:' || new URL(origin).origin !== origin)) {
    throw new Error('ALLOWED_ORIGINS must contain HTTPS origins');
  }

  const port = Number(env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  return { appwriteEndpoint, appwriteProjectId, appwriteApiKey, masterEncryptionKey, allowedOrigins, port };
}
