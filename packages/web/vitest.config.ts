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
    include: ['src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
    coverage: {
      include: ['src/**/*.{ts,tsx}'],
      // Minimums set ~1 point under coverage on 2026-10-26, re-measured after the
      // Vitest 5 upgrade changed how V8 coverage is counted; raise toward the 95% target (D-193).
      thresholds: { statements: 12, branches: 12, functions: 11, lines: 12 },
    },
  },
});
