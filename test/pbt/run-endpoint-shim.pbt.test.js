import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  runEndpoint,
  _resetRateLimitState,
  _recordRateLimitFailure,
  _cooldownRemainingMs,
  _RATE_LIMIT_CONFIG,
} from '../../src/adapter/run-endpoint.js';
import {
  getSharedLimiter,
  _resetSharedClient,
} from '../../src/adapter/rate-limiter-singleton.js';
import { property, gen } from './_harness.js';
import { createEndpointPage, withInstantTimers } from './_fake-pages.js';

const PATTERN = /\/fake\/endpoint/;

function spyAcquire() {
  const limiter = getSharedLimiter();
  const calls = [];
  const orig = limiter.acquire.bind(limiter);
  limiter.acquire = (label) => {
    calls.push(label);
    return orig(label);
  };
  return { calls, restore: () => { limiter.acquire = orig; } };
}

function makeMeta(name) {
  return {
    name,
    urlPattern: PATTERN,
    nav: { url: 'http://host/fake/endpoint' },
    isSuccess: (raw) => raw?.success === true,
    normalize: (raw) => ({ payload: raw.result ?? null, raw }),
  };
}

test('PROP-SHIM-1 / PROP-LIMIT-2: fixture mode yields 0 acquires', async () => {
  const prev = process.env.PDD_TEST_ADAPTER;
  process.env.PDD_TEST_ADAPTER = 'fixture';
  _resetSharedClient();
  const { calls, restore } = spyAcquire();
  try {
    await property(
      'fixture_zero_acquire',
      gen.int(1, 5),
      async (n) => {
        const startCalls = calls.length;
        const meta = {
          name: 'orders.list',
          urlPattern: PATTERN,
          nav: { url: 'http://host/fake/endpoint' },
          isSuccess: () => true,
        };
        for (let i = 0; i < n; i += 1) {
          await runEndpoint({ __fake: true }, meta, {}, {});
        }
        return calls.length === startCalls;
      },
      { runs: 5 },
    );
  } finally {
    restore();
    if (prev === undefined) delete process.env.PDD_TEST_ADAPTER;
    else process.env.PDD_TEST_ADAPTER = prev;
    _resetSharedClient();
  }
});

test('PROP-SHIM-2 / PROP-LIMIT-1: live mode returns data and acquires exactly once per call', async () => {
  const prev = process.env.PDD_TEST_ADAPTER;
  if (process.env.PDD_TEST_ADAPTER === 'fixture') delete process.env.PDD_TEST_ADAPTER;
  _resetSharedClient();
  const { calls, restore } = spyAcquire();
  try {
    await withInstantTimers(() =>
      property(
        'live_one_acquire_per_call',
        gen.int(1, 3),
        async (n) => {
          const startCalls = calls.length;
          const name = `pbt.shim.live.${n}.${Math.random().toString(36).slice(2, 6)}`;
          const meta = makeMeta(name);
          const page = createEndpointPage({
            respondBy: () => ({ status: 200, body: { success: true, errorCode: 0, result: { hit: true } } }),
          });
          let results = [];
          for (let i = 0; i < n; i += 1) {
            results.push(await runEndpoint(page, meta, {}, {}));
          }
          if (results.length !== n) return false;
          for (const r of results) {
            if (!r || r.payload?.hit !== true) return false;
          }
          return (calls.length - startCalls) === n;
        },
        { runs: 5 },
      )
    );
  } finally {
    restore();
    if (prev === undefined) delete process.env.PDD_TEST_ADAPTER;
    else process.env.PDD_TEST_ADAPTER = prev;
    _resetSharedClient();
  }
});

test('PROP-COOLDOWN-1: legacy exports observe cooldown state set by the shim', async () => {
  _resetRateLimitState();
  await property(
    'cooldown_exports_roundtrip',
    gen.int(1, 3),
    async (extra) => {
      const name = `pbt.shim.cooldown.${extra}.${Math.random().toString(36).slice(2, 6)}`;
      _resetRateLimitState();
      for (let i = 0; i < _RATE_LIMIT_CONFIG.cooldownThreshold + extra; i += 1) {
        _recordRateLimitFailure(name);
      }
      return _cooldownRemainingMs(name) > 0;
    },
    { runs: 5 },
  );
  _resetRateLimitState();
});
