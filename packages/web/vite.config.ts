import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // Route-level React.lazy handles page splitting; this keeps the big, stable
    // vendor libraries in their own long-cacheable chunks so the app shell and
    // per-page chunks stay lean.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
            { name: 'vendor-mui', test: /node_modules[\\/](@mui|@emotion)[\\/]/ },
            { name: 'vendor-monaco', test: /node_modules[\\/]@monaco-editor[\\/]/ },
            { name: 'vendor-data', test: /node_modules[\\/](@tanstack|zustand|socket\.io-client|zod)[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
