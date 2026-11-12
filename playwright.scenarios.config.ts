// ===========================================
// Migration Scenario Suite: Playwright config
// ===========================================
// Runs the operator scenarios in e2e/scenarios against a real server and a real
// Postgres database. Each scenario imports a Mirth Connect channel export,
// deploys it and sends real messages through real connectors.
//
// The suite owns its server: it never reuses one, so a developer's running
// server and database are never touched. It needs a migrated, seeded `*_test`
// database in SCENARIO_DATABASE_URL (see docs/testing/migration-scenarios.md).
//
// pnpm test:scenarios         run the suite
// pnpm test:scenarios:score   run it and print the weighted score

import { defineConfig } from '@playwright/test';

const databaseUrl = process.env.SCENARIO_DATABASE_URL ?? '';
if (!/_test$/i.test(new URL(databaseUrl || 'postgresql://x/none').pathname)) {
  throw new Error('SCENARIO_DATABASE_URL must point at a migrated, seeded *_test database.');
}

export const SCENARIO_API_PORT = 3100;

export default defineConfig({
  testDir: './e2e/scenarios',
  testMatch: /.*\.scenario\.ts$/,
  globalSetup: './e2e/scenarios/support/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['json', { outputFile: 'tmp/feature-climb/results.json' }]],
  webServer: {
    command: 'pnpm --filter @galvaniflow/server exec tsx src/index.ts',
    url: `http://localhost:${String(SCENARIO_API_PORT)}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'test',
      PORT: String(SCENARIO_API_PORT),
      DATABASE_URL: databaseUrl,
      JWT_SECRET: 'scenario-suite-jwt-secret-not-for-production-use',
      LOG_LEVEL: 'warn',
      API_RATE_LIMIT_MAX: '100000',
    },
  },
});
