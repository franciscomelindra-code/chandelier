import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// En développement, l'API (port 3000) est servie via le proxy Vite : même origine,
// cookies SameSite=Strict fonctionnels, aucun CORS à ouvrir.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/health': 'http://127.0.0.1:3000',
      '/ready': 'http://127.0.0.1:3000',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Pas de script inline : compatible avec la CSP stricte (script-src 'self').
    modulePreload: { polyfill: false },
  },
});
