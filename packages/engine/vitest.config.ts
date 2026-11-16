import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      // Worker-thread entries run only inside worker threads, which V8 coverage
      // does not collect; script-test-isolated and script-type-checker tests run them.
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/sandbox/script-test-worker.ts', 'src/sandbox/script-type-worker.ts'],
      // Minimums set ~1 point under coverage on 2026-10-26, re-measured after the
      // Vitest 5 upgrade changed how V8 coverage is counted; raise toward the 95% target (D-193).
      thresholds: { statements: 93, branches: 89, functions: 96, lines: 96 },
    },
  },
});
