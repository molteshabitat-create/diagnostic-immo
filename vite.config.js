import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // En dev local, on redirige les appels /api vers `vercel dev` (voir README)
    proxy: {
      '/api': 'http://localhost:3000'
    }
  }
});
