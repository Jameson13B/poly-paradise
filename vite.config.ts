import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  root: 'client',
  publicDir: '../public',
  // three.js is one ~560 kB chunk, but it loads lazily after the first paint.
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 700 },
  plugins: [preact()],
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/api': 'http://localhost:8787',
    },
  },
});
