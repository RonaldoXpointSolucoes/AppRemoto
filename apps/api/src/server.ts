import { buildApp } from './app.ts';
import { createAppwriteServices } from './appwrite/client.ts';
import { readApiConfig } from './config.ts';

const config = readApiConfig();
const trustProxy = Array.isArray(config.trustProxy)
  ? Array.from(new Set([...config.trustProxy, '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']))
  : config.trustProxy;
const app = buildApp({ logger: true, trustProxy }, createAppwriteServices(config), config.allowedOrigins);

try {
  await app.listen({ host: '0.0.0.0', port: config.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
