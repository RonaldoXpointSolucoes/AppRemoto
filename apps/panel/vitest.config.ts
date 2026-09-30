import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    exclude: ['src/**/*.server.test.ts', 'e2e/**', '.next/**', 'node_modules/**'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
