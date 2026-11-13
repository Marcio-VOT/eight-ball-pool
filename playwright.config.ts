import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:3100',
    viewport: { width: 1400, height: 860 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node ./node_modules/tsx/dist/cli.mjs server.ts',
    url: 'http://localhost:3100/api/health',
    env: {
      PORT: '3100',
    },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
