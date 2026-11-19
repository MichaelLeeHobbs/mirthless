import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // Spec files run in parallel; the tests inside one file still run in order on
  // one worker, because most files create a row in one test and edit or delete
  // it in the next. Files share the seeded database, so each works only on rows
  // with its own names and leaves server-wide settings as it found them (D-289).
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
  // CI has already run `pnpm build`, so it serves the built server and web
  // bundle. The Vite dev server sends every browser context hundreds of
  // unbundled modules, which made four workers CPU-bound on a 4-vCPU runner.
  // `vite preview` uses the dev server's /api and /socket.io proxy.
  webServer: [
    {
      command: process.env.CI ? 'pnpm --filter @galvanigraph/server start' : 'pnpm dev:server',
      url: 'http://localhost:3000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      // Every worker shares one IP: a full run at four workers came within 70
      // requests of the 1000-a-minute test default, and a slower one went over.
      // The limiter has unit tests; e2e doesn't test it.
      env: { API_RATE_LIMIT_MAX: '20000' },
    },
    {
      command: process.env.CI
        ? 'pnpm --filter @galvanigraph/web exec vite preview --port 5173 --strictPort'
        : 'pnpm dev:web',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
