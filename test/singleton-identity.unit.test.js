import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSharedLimiter,
  getSharedClient,
  _resetSharedLimiter,
  _resetSharedClient,
} from '../src/adapter/rate-limiter-singleton.js';

test('getSharedLimiter returns same reference across N calls', () => {
  _resetSharedClient();
  const first = getSharedLimiter();
  for (let i = 0; i < 5; i += 1) {
    assert.strictEqual(getSharedLimiter(), first);
  }
});

test('getSharedClient returns same reference across N calls', () => {
  _resetSharedClient();
  const first = getSharedClient();
  for (let i = 0; i < 5; i += 1) {
    assert.strictEqual(getSharedClient(), first);
  }
});

test('_resetSharedClient breaks identity (new instance next call)', () => {
  _resetSharedClient();
  const prev = getSharedClient();
  _resetSharedClient();
  const next = getSharedClient();
  assert.notStrictEqual(next, prev);
});

test('_resetSharedLimiter also forces new limiter on next call', () => {
  _resetSharedClient();
  const prev = getSharedLimiter();
  _resetSharedLimiter();
  const next = getSharedLimiter();
  assert.notStrictEqual(next, prev);
});

test('client references the shared limiter', () => {
  _resetSharedClient();
  const limiter = getSharedLimiter();
  const client = getSharedClient();
  assert.strictEqual(client._limiter, limiter);
});
