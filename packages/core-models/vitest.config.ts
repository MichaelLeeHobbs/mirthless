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
      // ~1 point under measured coverage; only raise, toward the 95% target (D-193).
      thresholds: { statements: 79, branches: 87, functions: 90, lines: 79 },
    },
  },
});
