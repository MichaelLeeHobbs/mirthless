// ===========================================
// Playwright E2E Test Configuration
// ===========================================

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // Spec files run in parallel; the tests inside one file still run in order on
  // one worker, because most files create a row in one test and edit or delete
  // it in the next. Files share the seeded database, so each works only on rows
  // with its own names and leaves server-wide settings as it found them (D-282).
  fullyParallel: false,
  workers: 4,
  retries: 0,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm dev:server',
      url: 'http://localhost:3000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'pnpm dev:web',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
