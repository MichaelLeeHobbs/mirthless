import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { quietWsProxyResetsPlugin } from './vite-proxy-logger.js';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
) as { version: string };

export default defineConfig({
  plugins: [react(), quietWsProxyResetsPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // Big, stable vendor libraries get their own long-cacheable chunks.
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
      // With the slash, as nginx has it (docker/nginx/default.conf): a bare '/api'
      // would also send the app's own /api-keys page to the server.
      '/api/': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/api-docs': {
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
