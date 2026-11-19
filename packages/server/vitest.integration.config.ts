import { defineConfig } from 'vitest/config';

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
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
