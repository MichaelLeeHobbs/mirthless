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
      // Minimums sit ~1 point under measured coverage (last raised 2026-11-13); raise
      // toward the 95% target (D-193).
      thresholds: { statements: 57, branches: 58, functions: 71, lines: 57 },
    },
  },
});
