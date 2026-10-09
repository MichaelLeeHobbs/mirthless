import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('test'),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    css: false,
    passWithNoTests: true,
    coverage: {
      // Minimums set 1 point under coverage on 2026-10-09; raise toward the 95% target (D-193).
      thresholds: { statements: 18, branches: 64, functions: 39, lines: 18 },
    },
  },
});
