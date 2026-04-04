import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:6831',
    headless: true,
  },
  webServer: {
    command: 'node src/server.mjs',
    port: 6831,
    reuseExistingServer: true,
    timeout: 15000,
  },
});
