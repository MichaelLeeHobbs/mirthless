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
  },
});
