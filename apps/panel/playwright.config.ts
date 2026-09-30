import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev --hostname 127.0.0.1 --port 3100',
    env: {
      NEXT_PUBLIC_APPWRITE_ENDPOINT: 'https://appwrite.example.test/v1',
      NEXT_PUBLIC_APPWRITE_PROJECT_ID: 'panel-test',
      NEXT_PUBLIC_API_BASE_URL: 'https://api.example.test',
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: 'http://127.0.0.1:3100/',
  },
});
