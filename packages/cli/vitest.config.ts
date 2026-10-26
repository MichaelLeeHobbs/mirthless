import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      include: ['src/**/*.ts'],
      // Minimums set ~1 point under coverage on 2026-10-26, re-measured after the
      // Vitest 5 upgrade changed how V8 coverage is counted; raise toward the 95% target (D-193).
      thresholds: { statements: 13, branches: 6, functions: 37, lines: 13 },
    },
  },
});
