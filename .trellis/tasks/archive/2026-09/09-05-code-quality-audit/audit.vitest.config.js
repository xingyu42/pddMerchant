import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  test: {
    include: ['.trellis/tasks/09-05-code-quality-audit/repro/*.test.js'],
    environment: 'node',
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 5000,
  },
});
