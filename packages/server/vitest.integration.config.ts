import { defineConfig } from 'vitest/config';

// ===========================================
// Integration (real Postgres) Vitest Config
// ===========================================
// Runs ONLY the *.itest.ts suites under test/integration against a real
// Postgres database. Kept separate from the default vitest.config.ts so that:
//   - `pnpm test` never touches a real DB (those suites use .itest.ts, which
//     the default `*.test.ts` include glob does not match), and
//   - test/setup.ts is NOT loaded here — that file overrides DATABASE_URL with
//     mock-DB credentials, which would defeat the point. Integration suites read
//     the real DATABASE_URL straight from the environment and self-skip unless
//     it points at a `*_test` database (see test/integration/_setup.ts).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.itest.ts'],
    passWithNoTests: true,
    // Suites share one database; run files sequentially to avoid connection
    // storms. Row-level isolation is guaranteed by per-test random channel IDs.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
