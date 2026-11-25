// The suite never reuses a server, so a developer's running server and database
// are never touched. Setup: docs/testing/migration-scenarios.md.

import { defineConfig } from '@playwright/test';
import { SCENARIO_FILE_ROOT } from './e2e/scenarios/support/files.js';
import { INTEGRATION_LIMIT_MS, INTEGRATION_WAIT_MS } from './packages/server/test/time-budgets.js';

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
  timeout: INTEGRATION_LIMIT_MS,
  // Every expect.poll: no scenario gives one a shorter time (D-374).
  expect: { timeout: INTEGRATION_WAIT_MS },
  reporter: [['list'], ['json', { outputFile: 'tmp/feature-climb/results.json' }]],
  webServer: {
    command: 'pnpm --filter @galvanigraph/server exec tsx src/index.ts',
    url: `http://localhost:${String(SCENARIO_API_PORT)}/api/v1/health`,
    reuseExistingServer: false,
    timeout: INTEGRATION_LIMIT_MS,
    // A refusal or a 500 names its cause only in the server's log.
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'test',
      PORT: String(SCENARIO_API_PORT),
      DATABASE_URL: databaseUrl,
      JWT_SECRET: 'scenario-suite-jwt-secret-not-for-production-use',
      LOG_LEVEL: 'warn',
      API_RATE_LIMIT_MAX: '100000',
      DATABASE_CONNECT_TIMEOUT_MS: String(INTEGRATION_WAIT_MS),
      AUDIT_WRITE_TIMEOUT_MS: String(INTEGRATION_WAIT_MS),
      FILE_CONNECTOR_ROOTS: SCENARIO_FILE_ROOT,
    },
  },
});
