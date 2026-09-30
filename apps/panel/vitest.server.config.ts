import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['react-server'] },
  ssr: { resolve: {
    conditions: ['react-server'],
    externalConditions: ['react-server'],
  } },
  test: { include: ['src/**/*.server.test.ts'] },
});
