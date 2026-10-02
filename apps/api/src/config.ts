import { isIP } from 'node:net';

const productionAppwriteEndpoint = 'https://appwrite.xpointsolucoes.com.br/v1';
const productionAppwriteProjectId = '6abc5640003cb361b809';

export interface ApiConfig {
  appwriteEndpoint: string;
  appwriteProjectId: string;
  appwriteApiKey: string;
  masterEncryptionKey: Buffer;
  encryptionKeyVersion: number;
  apiReplicas: 1;
  trustProxy: false | string[];
  allowedOrigins: string[];
  port: number;
  genericInstallerSharedPassword?: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function readApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const appwriteEndpoint = env.APPWRITE_ENDPOINT;
  if (appwriteEndpoint !== productionAppwriteEndpoint) {
    throw new Error('APPWRITE_ENDPOINT does not match the approved production target');
  }
  const appwriteProjectId = env.APPWRITE_PROJECT_ID;
  if (appwriteProjectId !== productionAppwriteProjectId) {
    throw new Error('APPWRITE_PROJECT_ID does not match the approved production target');
  }
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

  const portValue = env.PORT ?? '3000';
  const port = Number(portValue);
  if (!/^[1-9]\d{0,4}$/.test(portValue) || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  if ((env.API_REPLICAS ?? '1') !== '1' || (env.WEB_CONCURRENCY ?? '1') !== '1' ||
      (env.NODE_APP_INSTANCE ?? '0') !== '0') {
    throw new Error('Enrollment requires exactly one API replica and process');
  }
  const encryptionKeyVersion = Number(env.MASTER_ENCRYPTION_KEY_VERSION ?? '1');
  if (!Number.isInteger(encryptionKeyVersion) || encryptionKeyVersion < 1 || encryptionKeyVersion > 65535) {
    throw new Error('MASTER_ENCRYPTION_KEY_VERSION must be an integer between 1 and 65535');
  }
  let trustProxy: false | string[] = false;
  if (env.TRUST_PROXY && env.TRUST_PROXY !== 'false') {
    trustProxy = env.TRUST_PROXY.split(',').map((entry) => entry.trim());
    if (trustProxy.some((entry) => {
      const parts = entry.split('/'); const family = isIP(parts[0]!);
      return !family || parts.length > 2 || (parts.length === 2 &&
        (!/^\d+$/.test(parts[1]!) || Number(parts[1]) < 1 || Number(parts[1]) > (family === 4 ? 32 : 128)));
    })) throw new Error('TRUST_PROXY must be false or explicit trusted IP addresses/CIDRs');
  }
  const genericInstallerSharedPassword = env.GENERIC_INSTALLER_SHARED_PASSWORD;
  if (genericInstallerSharedPassword !== undefined &&
      (genericInstallerSharedPassword.length < 16 || genericInstallerSharedPassword.length > 128 ||
       Buffer.byteLength(genericInstallerSharedPassword, 'utf8') > 128 ||
       /[\u0000-\u001f\u007f]/.test(genericInstallerSharedPassword) ||
       Buffer.from(genericInstallerSharedPassword, 'utf8').toString('utf8') !== genericInstallerSharedPassword)) {
    throw new Error('GENERIC_INSTALLER_SHARED_PASSWORD must be a valid 16 to 128 character secret');
  }
  return { appwriteEndpoint, appwriteProjectId, appwriteApiKey, masterEncryptionKey, encryptionKeyVersion,
    apiReplicas: 1, trustProxy, allowedOrigins, port,
    ...(genericInstallerSharedPassword !== undefined ? { genericInstallerSharedPassword } : {}) };
}
