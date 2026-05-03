import { describe, it } from 'vitest';
import { strict as assert } from 'node:assert';
import { property, gen } from './_harness.js';

describe('auth-refresher PBT', () => {
  it('PROP-REFRESH-1: mockRefreshAuth returns valid shape', async () => {
    const origEnv = process.env.PDD_TEST_ADAPTER;
    const origAuth = process.env.PDD_TEST_AUTH_INVALID;
    process.env.PDD_TEST_ADAPTER = 'fixture';

    try {
      const { mockRefreshAuth } = await import('../../src/adapter/mock-dispatcher.js');

      await property(
        'mock refresh shape — success',
        gen.bool(),
        (authInvalid) => {
          process.env.PDD_TEST_AUTH_INVALID = authInvalid ? '1' : '';
          const result = mockRefreshAuth();
          assert.ok(typeof result === 'object');
          assert.ok(typeof result.success === 'boolean');
          assert.ok(typeof result.reason === 'string');
          if (result.success) {
            assert.strictEqual(result.reason, 'refreshed');
          } else {
            assert.strictEqual(result.reason, 'auth_expired');
          }
          return true;
        },
        { runs: 20 },
      );
    } finally {
      if (origEnv !== undefined) process.env.PDD_TEST_ADAPTER = origEnv;
      else delete process.env.PDD_TEST_ADAPTER;
      if (origAuth !== undefined) process.env.PDD_TEST_AUTH_INVALID = origAuth;
      else delete process.env.PDD_TEST_AUTH_INVALID;
    }
  });

  it('PROP-REFRESH-2: refreshAuth returns auth_missing for nonexistent path', async () => {
    const origEnv = process.env.PDD_TEST_ADAPTER;
    delete process.env.PDD_TEST_ADAPTER;

    try {
      const { refreshAuth } = await import('../../src/adapter/auth-refresher.js');

      await property(
        'auth_missing for nonexistent path',
        gen.string({ minLen: 10, maxLen: 20 }),
        async (randomSuffix) => {
          const result = await refreshAuth({
            authStatePath: `/tmp/nonexistent-${randomSuffix}.json`,
          });
          assert.strictEqual(result.success, false);
          assert.strictEqual(result.reason, 'auth_missing');
          return true;
        },
        { runs: 10 },
      );
    } finally {
      if (origEnv !== undefined) process.env.PDD_TEST_ADAPTER = origEnv;
      else delete process.env.PDD_TEST_ADAPTER;
    }
  });
});
