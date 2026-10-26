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
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      // Minimums set 1 point under coverage on 2026-10-09; raise toward the 95% target (D-193).
      thresholds: { statements: 96, branches: 88, functions: 96, lines: 96 },
    },
  },
});
