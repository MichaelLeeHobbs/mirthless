import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    // Tests that compile or run scripts take seconds on a loaded machine (#125). A hung
    // test still fails, just later; tests about a time limit set their own short budget.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      // Worker-thread entries run only inside worker threads, which V8 coverage
      // does not collect; script-test-isolated and script-type-checker tests run them.
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/support/**', 'src/index.ts', 'src/sandbox/script-test-worker.ts', 'src/sandbox/script-type-worker.ts'],
      // About 1 point under measured coverage; only ever raised, toward the 95% target (D-193).
      thresholds: { statements: 94, branches: 89, functions: 96, lines: 96 },
    },
  },
});
