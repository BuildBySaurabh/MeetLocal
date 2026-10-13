import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { buildSecurityHeaders } from './securityHeaders.mjs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react()],
    server: { port: 5173, strictPort: true },
    // `npm run preview` serves the production build with the production security headers.
    preview: {
      port: 4173,
      strictPort: true,
      headers: buildSecurityHeaders({ signalingUrl: env.VITE_SIGNALING_URL || 'ws://localhost:8787' }),
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
