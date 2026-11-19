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
      thresholds: { statements: 93, branches: 83, functions: 92, lines: 96 },
    },
  },
});
