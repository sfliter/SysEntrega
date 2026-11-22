import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        // Mantém o Host original: o IP e a origem chegam à API como em produção
        xfwd: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
