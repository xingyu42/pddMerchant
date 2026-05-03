import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 30_000,
    pool: 'forks',
  },
});
