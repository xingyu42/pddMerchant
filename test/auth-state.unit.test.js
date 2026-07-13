import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deleteAuthState, isAuthValid, isConsumerAuthValid } from '../src/adapter/auth-state.js';

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

test('isAuthValid: does not wait for networkidle after domcontentloaded', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  let waitForLoadStateCalls = 0;
  const page = {
    async goto() {
      return createResponse({ ok: true, status: 200 });
    },
    async waitForLoadState() {
      waitForLoadStateCalls += 1;
    },
    url() {
      return 'https://mms.pinduoduo.com/home/';
    },
  };

  const valid = await isAuthValid(page, { timeoutMs: 10, maxAttempts: 1 });

  assert.equal(valid, true);
  assert.equal(waitForLoadStateCalls, 0);
});

test('isConsumerAuthValid: does not wait for networkidle after domcontentloaded', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  let waitForLoadStateCalls = 0;
  const page = {
    async goto() {
      return createResponse({ ok: true, status: 200 });
    },
    async waitForLoadState() {
      waitForLoadStateCalls += 1;
    },
    url() {
      return 'https://mobile.yangkeduo.com/';
    },
  };

  const valid = await isConsumerAuthValid(page, { timeoutMs: 10 });

  assert.equal(valid, true);
  assert.equal(waitForLoadStateCalls, 0);
});

test('deleteAuthState: permanently removes an existing auth snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pdd-auth-delete-'));
  const path = join(root, 'consumer-auth-state.json');
  try {
    await writeFile(path, '{"cookies":[],"origins":[]}', 'utf8');
    const result = await deleteAuthState(path);
    assert.deepEqual(result, { removed: true, existed: true });
    await assert.rejects(() => readFile(path), (err) => err.code === 'ENOENT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('deleteAuthState: treats an already-missing snapshot as removed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pdd-auth-delete-'));
  try {
    const result = await deleteAuthState(join(root, 'missing.json'));
    assert.deepEqual(result, { removed: true, existed: false });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
