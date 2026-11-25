import { defineConfig } from 'vitest/config';
import { INTEGRATION_LIMIT_MS, INTEGRATION_WAIT_MS } from './test/time-budgets.js';

// Apart from vitest.config.ts: its `*.test.ts` glob keeps these `.itest.ts`
// suites out of `pnpm test`, and its test/setup.ts would point DATABASE_URL at
// mock credentials. Suites self-skip unless DATABASE_URL names a `*_test`
// database (test/integration/_setup.ts).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.itest.ts'],
    passWithNoTests: true,
    // Suites share one database; sequential files avoid connection storms.
    fileParallelism: false,
    testTimeout: INTEGRATION_LIMIT_MS,
    hookTimeout: INTEGRATION_LIMIT_MS,
    expect: { poll: { timeout: INTEGRATION_WAIT_MS } },
    // The child processes the suites start take it too.
    env: { DATABASE_CONNECT_TIMEOUT_MS: String(INTEGRATION_WAIT_MS), AUDIT_WRITE_TIMEOUT_MS: String(INTEGRATION_WAIT_MS) },
  },
});
