import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
    fs: { allow: [path.resolve(__dirname, '../..')] },
  },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 1600 },
});
