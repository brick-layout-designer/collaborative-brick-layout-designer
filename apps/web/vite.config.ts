import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-server port and API origin default to the standard :5173 → :3000
// setup; override with VITE_PORT / CLD_API_ORIGIN to run a second stack
// side by side (e.g. VITE_PORT=5273 CLD_API_ORIGIN=http://localhost:3100).
const apiOrigin = process.env.CLD_API_ORIGIN ?? 'http://localhost:3000';
const wsOrigin = apiOrigin.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    proxy: {
      '/api': apiOrigin,
      '/ws': { target: wsOrigin, ws: true },
      '/parts': apiOrigin,
    },
  },
});
