import { createLogger, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { quietWsProxyResets } from './vite-proxy-logger.js';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
) as { version: string };

export default defineConfig({
  plugins: [react()],
  // The dev server and `vite preview` both log through this; it drops the websocket
  // proxy's reset/EPIPE lines from closed tabs and nothing else (#167).
  customLogger: quietWsProxyResets(createLogger()),
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
            // Vite's preload helper is shared by every lazy import. Left alone it lands in
            // vendor-monaco (Monaco uses dynamic imports too) and drags 4 MB into the first load.
            { name: 'preload-helper', test: /preload-helper/, priority: 100 },
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
            { name: 'vendor-mui', test: /node_modules[\\/](@mui|@emotion)[\\/]/ },
            { name: 'vendor-monaco', test: /node_modules[\\/](@monaco-editor|monaco-editor)[\\/]/ },
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
