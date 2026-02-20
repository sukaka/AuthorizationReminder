import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.js'],
    testTimeout: 120000,
    hookTimeout: 120000,
    isolate: false,
    sequence: {
      concurrent: false,
    },
  },
});
