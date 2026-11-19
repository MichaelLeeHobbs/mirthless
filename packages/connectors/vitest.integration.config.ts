import { defineConfig } from 'vitest/config';

// The *.itest.ts suites, against the docker-compose test services. A suite skips
// when its service env is absent; CI sets CONNECTOR_ITEST_REQUIRED=1 so a skip
// fails there. Separate from vitest.config.ts so `pnpm test` never needs infra.

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.itest.ts'],
    // CI requires every suite (gates.ts), so finding no suite at all is a failure there too.
    passWithNoTests: process.env.CONNECTOR_ITEST_REQUIRED !== '1',
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
