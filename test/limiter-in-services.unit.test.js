import { test } from 'vitest';
import assert from 'node:assert/strict';
import { runEndpoint } from '../src/adapter/run-endpoint.js';
import {
  getSharedLimiter,
  _resetSharedClient,
} from '../src/adapter/rate-limiter-singleton.js';

function spyOnAcquire(limiter) {
  const calls = [];
  const orig = limiter.acquire.bind(limiter);
  limiter.acquire = (label) => {
    calls.push(label);
    return orig(label);
  };
  return { calls, restore: () => { limiter.acquire = orig; } };
}

test('fixture mode → runEndpoint does not acquire any token', async () => {
  const prev = process.env.PDD_TEST_ADAPTER;
  const prevFixtureDir = process.env.PDD_TEST_FIXTURE_DIR;
  process.env.PDD_TEST_ADAPTER = 'fixture';
  _resetSharedClient();
  const limiter = getSharedLimiter();
  const { calls, restore } = spyOnAcquire(limiter);

  try {
    const meta = {
      name: 'orders.list',
      urlPattern: /\/fake/,
      nav: { url: 'http://host/fake' },
      isSuccess: () => true,
    };
    await runEndpoint({ __fake: true }, meta, {}, {});
    assert.equal(calls.length, 0, 'fixture-mode runEndpoint MUST NOT acquire tokens');
  } finally {
    restore();
    if (prev === undefined) delete process.env.PDD_TEST_ADAPTER;
    else process.env.PDD_TEST_ADAPTER = prev;
    if (prevFixtureDir === undefined) delete process.env.PDD_TEST_FIXTURE_DIR;
    else process.env.PDD_TEST_FIXTURE_DIR = prevFixtureDir;
  }
});

test('live mode → runEndpoint acquires exactly one token per call before nav failure', async () => {
  const prev = process.env.PDD_TEST_ADAPTER;
  if (process.env.PDD_TEST_ADAPTER === 'fixture') delete process.env.PDD_TEST_ADAPTER;
  _resetSharedClient();
  const limiter = getSharedLimiter();
  const { calls, restore } = spyOnAcquire(limiter);

  const failingPage = {
    on() {},
    off() {},
    async goto() { throw new Error('simulated nav failure'); },
    async waitForSelector() {},
    url: () => 'http://fake/',
  };
  const meta = {
    name: 'test.liveAcquire',
    urlPattern: /\/never/,
    nav: { url: 'http://host/never' },
    isSuccess: () => true,
  };

  try {
    await runEndpoint(failingPage, meta, {}, {});
    assert.fail('runEndpoint should have thrown');
  } catch (err) {
    assert.equal(err.code, 'E_NETWORK', `expected E_NETWORK, got ${err.code}`);
    assert.equal(calls.length, 1, `expected 1 acquire call, got ${calls.length}`);
    assert.equal(calls[0], 'test.liveAcquire');
  } finally {
    restore();
    if (prev === undefined) delete process.env.PDD_TEST_ADAPTER;
    else process.env.PDD_TEST_ADAPTER = prev;
  }
});

test('live mode → N live calls produce exactly N acquires', async () => {
  const prev = process.env.PDD_TEST_ADAPTER;
  if (process.env.PDD_TEST_ADAPTER === 'fixture') delete process.env.PDD_TEST_ADAPTER;
  _resetSharedClient();
  const limiter = getSharedLimiter();
  const { calls, restore } = spyOnAcquire(limiter);

  const failingPage = {
    on() {},
    off() {},
    async goto() { throw new Error('nav fail'); },
    async waitForSelector() {},
    url: () => 'http://fake/',
  };
  const meta = {
    name: 'test.liveAcquireN',
    urlPattern: /\/never/,
    nav: { url: 'http://host/never' },
    isSuccess: () => true,
  };

  try {
    for (let i = 0; i < 3; i += 1) {
      await runEndpoint(failingPage, meta, {}, {}).catch(() => {});
    }
    assert.equal(calls.length, 3);
  } finally {
    restore();
    if (prev === undefined) delete process.env.PDD_TEST_ADAPTER;
    else process.env.PDD_TEST_ADAPTER = prev;
  }
});
