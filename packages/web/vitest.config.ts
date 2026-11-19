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
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      include: ['src/**/*.{ts,tsx}'],
      // About 1 point under measured coverage; only ever raised, toward the 95% target (D-193).
      thresholds: { statements: 26, branches: 29, functions: 23, lines: 26 },
    },
  },
});
