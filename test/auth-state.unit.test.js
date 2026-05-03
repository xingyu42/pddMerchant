import { test } from 'vitest';
import assert from 'node:assert/strict';
import { isAuthValid } from '../src/adapter/auth-state.js';

function createResponse({ ok = true, status = 200 } = {}) {
  return {
    ok() {
      return ok;
    },
    status() {
      return status;
    },
  };
}

test('isAuthValid: retries once when first goto throws and second attempt succeeds', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  let gotoCalls = 0;
  const page = {
    async goto() {
      gotoCalls += 1;
      if (gotoCalls === 1) {
        throw new Error('transient navigation failure');
      }
      return createResponse({ ok: true, status: 200 });
    },
    async waitForLoadState() {
      return undefined;
    },
    url() {
      return 'https://mms.pinduoduo.com/home/';
    },
  };

  const valid = await isAuthValid(page, { timeoutMs: 10, maxAttempts: 2 });
  assert.equal(valid, true);
  assert.equal(gotoCalls, 2);
});

test('isAuthValid: returns false after all retry attempts fail', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  let gotoCalls = 0;
  const page = {
    async goto() {
      gotoCalls += 1;
      throw new Error(`navigation failed ${gotoCalls}`);
    },
    async waitForLoadState() {
      return undefined;
    },
    url() {
      return 'https://mms.pinduoduo.com/home/';
    },
  };

  const valid = await isAuthValid(page, { timeoutMs: 10, maxAttempts: 2 });
  assert.equal(valid, false);
  assert.equal(gotoCalls, 2);
});

test('isAuthValid: returns false when navigation lands on login page', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  const page = {
    async goto() {
      return createResponse({ ok: true, status: 200 });
    },
    async waitForLoadState() {
      return undefined;
    },
    url() {
      return 'https://mms.pinduoduo.com/login';
    },
  };

  const valid = await isAuthValid(page, { timeoutMs: 10, maxAttempts: 2 });
  assert.equal(valid, false);
});
