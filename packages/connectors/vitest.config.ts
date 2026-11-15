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
      // The integration lane (*.itest.ts and its gates) is test code that this run never loads.
      exclude: ['src/**/*.test.ts', 'src/**/*.itest.ts', 'src/__tests__/e2e/integration/gates.ts', 'src/index.ts'],
      // Minimums set ~1 point under coverage on 2026-11-14, when the integration
      // lane stopped counting as uncovered source; raise toward the 95% target (D-193).
      thresholds: { statements: 89, branches: 78, functions: 85, lines: 91 },
    },
  },
});
