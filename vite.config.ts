import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  root: 'client',
  publicDir: '../public',
  build: { outDir: '../dist', emptyOutDir: true },
  plugins: [preact()],
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/api': 'http://localhost:8787',
    },
  },
});
