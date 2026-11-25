import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    // Longer than every limit the code under test sets itself, worker starts included, so that a
    // test on a loaded machine sees the code's answer (D-369). Tests about a limit set a short one.
    testTimeout: 120_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      // Worker-thread entries run only inside worker threads, which V8 coverage
      // does not collect; script-test-isolated and script-type-checker tests run them.
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/support/**', 'src/index.ts', 'src/sandbox/script-test-worker.ts', 'src/sandbox/script-type-worker.ts'],
      // About 1 point under measured coverage; only ever raised, toward the 95% target (D-193).
      thresholds: { statements: 95, branches: 90, functions: 96, lines: 96 },
    },
  },
});
