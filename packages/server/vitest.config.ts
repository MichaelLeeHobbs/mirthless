import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    passWithNoTests: true,
    pool: 'forks',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/db/migrations/**'],
      // Minimums set ~1 point under coverage on 2026-10-26, re-measured after the
      // Vitest 5 upgrade changed how V8 coverage is counted; raise toward the 95% target (D-193).
      thresholds: { statements: 52, branches: 50, functions: 65, lines: 53 },
    },
  },
});
