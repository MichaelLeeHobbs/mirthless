import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    // Same budget as engine and server (D-290): the e2e suites compile scripts and move
    // messages over real sockets, which takes seconds on a loaded machine (#213).
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      // The integration lane (*.itest.ts and its support) is test code that this run never loads.
      exclude: ['src/**/*.test.ts', 'src/**/*.itest.ts', 'src/__tests__/e2e/integration/**', 'src/index.ts'],
      // About 1 point under measured coverage; only ever raised, toward the 95% target (D-193).
      thresholds: { statements: 93, branches: 90, functions: 91, lines: 95 },
    },
  },
});
