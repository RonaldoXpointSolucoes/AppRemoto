import { buildApp } from './app.ts';
import { readApiConfig } from './config.ts';

const config = readApiConfig();
const app = buildApp({ logger: true });

try {
  await app.listen({ host: '0.0.0.0', port: config.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
