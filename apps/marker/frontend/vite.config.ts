import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8080',
      '/admin': 'http://localhost:8080',
      '/auth': 'http://localhost:8080',
      '/files': 'http://localhost:8080',
      '/health': 'http://localhost:8080',
    },
  },
});
