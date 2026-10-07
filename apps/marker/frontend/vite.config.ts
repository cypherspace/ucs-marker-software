import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // .env.example puts the VITE_* settings in the repo-root .env, not in this folder.
  envDir: fileURLToPath(new URL('../../..', import.meta.url)),
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8080',
      '/admin/v1': 'http://localhost:8080',
      '/auth': 'http://localhost:8080',
      '/files': 'http://localhost:8080',
      '/health': 'http://localhost:8080',
    },
  },
});
