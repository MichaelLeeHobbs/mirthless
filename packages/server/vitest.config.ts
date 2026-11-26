import { defineConfig } from 'vitest/config';
import { FAKED_TIMERS } from './test/fake-timers.js';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    passWithNoTests: true,
    // Tests that compile or run scripts take seconds on a loaded machine (#125). A hung
    // test still fails, just later; tests about a time limit set their own short budget.
    testTimeout: 30_000,
    fakeTimers: { toFake: [...FAKED_TIMERS] },
    pool: 'forks',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      // The watchdog's thread and its tests' child processes run where V8 coverage does not look.
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/support/**', 'src/lib/script-watchdog-worker.ts', 'src/db/migrations/**'],
      // ~1 point under measured coverage; only raised, toward the 95% target (D-193).
      thresholds: { statements: 57, branches: 58, functions: 71, lines: 57 },
    },
  },
});
