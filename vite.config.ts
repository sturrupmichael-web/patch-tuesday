import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Served from michaelsturrup.com/patch-tuesday/. Override with VITE_BASE if needed.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/patch-tuesday/',
  build: {
    rollupOptions: {
      input: {
        phone: resolve(__dirname, 'index.html'),
        host: resolve(__dirname, 'host/index.html'),
      },
    },
  },
  server: { host: true },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
