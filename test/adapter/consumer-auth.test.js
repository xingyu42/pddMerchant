import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import { isConsumerAuthValid } from '../../src/adapter/consumer-auth.js';
import { composeCommandRuntime } from '../../src/runtime/command-runtime.js';

describe('isConsumerAuthValid', () => {
  it('returns true in fixture mode unless PDD_TEST_CONSUMER_AUTH_INVALID is set', async () => {
    const validRuntime = await composeCommandRuntime({ mode: 'fixture', runtimeConfigPolicy: 'maintenance', env: {} });
    const invalidRuntime = await composeCommandRuntime({
      mode: 'fixture',
      runtimeConfigPolicy: 'maintenance',
      env: { PDD_TEST_CONSUMER_AUTH_INVALID: '1' },
    });
    try {
      assert.equal((await validRuntime.ports.auth.checkConsumerOnline()).ok, true);
      assert.equal((await invalidRuntime.ports.auth.checkConsumerOnline()).ok, false);
    } finally {
      await validRuntime.closeAll();
      await invalidRuntime.closeAll();
    }
  });

  it('navigates to consumer home in live mode and rejects login redirects or navigation failures', async () => {
    vi.stubEnv('PDD_TEST_ADAPTER', '');
    const calls = [];
    const okPage = {
      goto: async (url, opts) => { calls.push([url, opts]); },
      url: () => 'https://mobile.yangkeduo.com/home',
    };
    assert.equal(await isConsumerAuthValid(okPage, { timeoutMs: 2500 }), true);
    assert.deepEqual(calls, [['https://mobile.yangkeduo.com', { waitUntil: 'domcontentloaded', timeout: 2500 }]]);

    const loginPage = {
      goto: async () => {},
      url: () => 'https://mobile.yangkeduo.com/login.html',
    };
    assert.equal(await isConsumerAuthValid(loginPage), false);

    const failingPage = {
      goto: async () => { throw new Error('navigation failed'); },
      url: () => 'https://mobile.yangkeduo.com/',
    };
    assert.equal(await isConsumerAuthValid(failingPage), false);
  });
});
