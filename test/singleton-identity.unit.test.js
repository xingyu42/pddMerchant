import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  getSharedLimiter,
  getSharedClient,
  _resetSharedLimiter,
  _resetSharedClient,
} from '../src/adapter/rate-limiter-singleton.js';
import { TEST_RUNTIME_CONFIG } from './helpers/runtime-config.js';

test('getSharedLimiter returns same reference across N calls', () => {
  _resetSharedClient();
  const first = getSharedLimiter(TEST_RUNTIME_CONFIG);
  for (let i = 0; i < 5; i += 1) {
    assert.strictEqual(getSharedLimiter(), first);
  }
});

test('getSharedClient returns same reference across N calls', () => {
  _resetSharedClient();
  const first = getSharedClient(TEST_RUNTIME_CONFIG);
  for (let i = 0; i < 5; i += 1) {
    assert.strictEqual(getSharedClient(), first);
  }
});

test('_resetSharedClient breaks identity (new instance next call)', () => {
  _resetSharedClient();
  const prev = getSharedClient(TEST_RUNTIME_CONFIG);
  _resetSharedClient();
  const next = getSharedClient(TEST_RUNTIME_CONFIG);
  assert.notStrictEqual(next, prev);
});

test('_resetSharedLimiter also forces new limiter on next call', () => {
  _resetSharedClient();
  const prev = getSharedLimiter(TEST_RUNTIME_CONFIG);
  _resetSharedLimiter();
  const next = getSharedLimiter(TEST_RUNTIME_CONFIG);
  assert.notStrictEqual(next, prev);
});

test('client references the shared limiter', () => {
  _resetSharedClient();
  const limiter = getSharedLimiter(TEST_RUNTIME_CONFIG);
  const client = getSharedClient(TEST_RUNTIME_CONFIG);
  assert.strictEqual(client._limiter, limiter);
});
