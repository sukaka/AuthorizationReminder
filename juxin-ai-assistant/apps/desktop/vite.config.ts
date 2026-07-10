import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const apiProxyTarget = 'http://127.0.0.1:5193';
const apiProxyPrefixes = [
  '/api/ai',
  '/api/export',
  '/api/knowledge',
  '/api/personal-reference',
  '/api/conversations',
];
const authProxyPrefixes = ['/portal', '/api/auth'];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 18093,
    proxy: {
      ...Object.fromEntries(apiProxyPrefixes.map((prefix) => [prefix, apiProxyTarget])),
      ...Object.fromEntries(
        authProxyPrefixes.map((prefix) => [prefix, 'http://127.0.0.1:5180']),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
  },
});
