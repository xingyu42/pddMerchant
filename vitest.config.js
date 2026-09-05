import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [{
    name: 'daemon-test-shebang',
    enforce: 'pre',
    transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/bin/pdd-daemon.js')) {
        // Vitest wraps imports before evaluation; a shebang is only legal at byte zero.
        return { code: code.replace(/^#![^\r\n]*/, ''), map: null };
      }
    },
  }],
  test: {
    include: ['test/**/*.test.js'],
    setupFiles: ['./test/setup.js'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 30_000,
    pool: 'forks',
  },
});
