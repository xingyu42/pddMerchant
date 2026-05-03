import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  runEndpoint,
  readBusinessError,
  _resetRateLimitState,
  _recordRateLimitFailure,
  _cooldownRemainingMs,
  _RATE_LIMIT_CONFIG,
} from '../../src/adapter/run-endpoint.js';
import { property, gen } from './_harness.js';
import { createEndpointPage, withInstantTimers } from './_fake-pages.js';

const PATTERN = /\/fake\/endpoint/;

// PBT 6.5: function-form nav.url evaluated exactly once per runEndpoint call,
// even if 429 retries happen. Successful responses: no retry; retried responses
// (429→200): still only one nav.url evaluation (runEndpoint caches navUrl).
test('pbt: run_endpoint_nav_resolution evaluates fn nav.url exactly once', async () => {
  await withInstantTimers(() =>
    property(
      'nav_resolution_once',
      gen.record({
        initial429s: gen.int(0, 3),
        snSuffix: gen.string({ minLen: 1, maxLen: 6 }),
      }),
      async ({ initial429s, snSuffix }) => {
        let navCalls = 0;
        let respIdx = 0;
        const statuses = [...Array(initial429s).fill(429), 200];
        const page = createEndpointPage({
          respondBy: () => {
            const s = statuses[Math.min(respIdx, statuses.length - 1)];
            respIdx += 1;
            return { status: s, body: { success: true, errorCode: 0, result: {} } };
          },
        });
        const meta = {
          name: 'pbt.navFnOnce',
          urlPattern: PATTERN,
          nav: {
            url: (params) => {
              navCalls += 1;
              return `http://host/fake/endpoint?sn=${params.sn}`;
            },
          },
          isSuccess: (raw) => raw?.success === true,
        };
        await runEndpoint(page, meta, { sn: `sn-${snSuffix}` }, {});
        return navCalls === 1 && respIdx === initial429s + 1;
      },
      { runs: 20 },
    )
  );
});

// PBT 6.5b: throwing nav.url function rejects with E_USAGE (no swallowing).
test('pbt: run_endpoint throwing nav.url propagates as E_USAGE', async () => {
  await property(
    'nav_resolution_throws',
    gen.record({ errMsg: gen.string({ minLen: 3, maxLen: 20 }) }),
    async ({ errMsg }) => {
      const page = createEndpointPage({ respondBy: () => ({ status: 200, body: {} }) });
      const meta = {
        name: 'pbt.navThrows',
        urlPattern: PATTERN,
        nav: {
          url: () => { throw new Error(errMsg); },
        },
        isSuccess: () => true,
      };
      try {
        await runEndpoint(page, meta, {}, {});
        return false;
      } catch (err) {
        return err?.code === 'E_USAGE' && err?.message?.includes(errMsg);
      }
    },
    { runs: 20 },
  );
});

// PBT 6.6: 429 retries exactly up to 3 times; K∈[0,3]→success, K≥4→E_RATE_LIMIT.
test('pbt: run_endpoint_429_retry count invariant', async () => {
  await withInstantTimers(() =>
    property(
      '429_retry_count',
      gen.int(0, 6),
      async (initial429s) => {
        let respIdx = 0;
        const page = createEndpointPage({
          respondBy: () => {
            const s = respIdx < initial429s ? 429 : 200;
            respIdx += 1;
            return { status: s, body: { success: true, errorCode: 0, result: {} } };
          },
        });
        const meta = {
          name: 'pbt.retry429',
          urlPattern: PATTERN,
          nav: { url: 'http://host/fake/endpoint' },
          isSuccess: (raw) => raw?.success === true,
        };
        try {
          await runEndpoint(page, meta, {}, {});
          if (initial429s > 3) return false;
          return respIdx === initial429s + 1;
        } catch (err) {
          if (initial429s <= 3) return false;
          return err?.code === 'E_RATE_LIMIT' && respIdx === 4;
        }
      },
      { runs: 20 },
    )
  );
});

// PBT 6.7: readBusinessError honors snake/camel + success sentinels.
// Sentinels = {0, 1000000}; non-sentinel non-null → {code: String, message: String}.
test('pbt: read_business_error_naming_compat', async () => {
  const codeChoices = [null, undefined, 0, 1000000, 1, 1000, 54001, -1, '0', '1000'];
  const msgChoices = [null, undefined, '', '错误信息', 'network error', 0, 42];

  await property(
    'business_error_naming',
    gen.record({
      snakeCode: gen.oneOf(codeChoices),
      camelCode: gen.oneOf(codeChoices),
      snakeMsg: gen.oneOf(msgChoices),
      camelMsg: gen.oneOf(msgChoices),
      useSnakeCodeKey: gen.bool(),
      useCamelCodeKey: gen.bool(),
      useSnakeMsgKey: gen.bool(),
      useCamelMsgKey: gen.bool(),
    }),
    (s) => {
      const raw = {};
      if (s.useSnakeCodeKey) raw.error_code = s.snakeCode;
      if (s.useCamelCodeKey) raw.errorCode = s.camelCode;
      if (s.useSnakeMsgKey) raw.error_msg = s.snakeMsg;
      if (s.useCamelMsgKey) raw.errorMsg = s.camelMsg;

      const result = readBusinessError(raw);

      // Mirror source-code contract:
      //   code = raw.error_code ?? raw.errorCode
      //   msg  = raw.error_msg ?? raw.errorMsg
      //   if code == null → null; if code ∈ {0, 1000000} → null; else {code:String, message:String(msg??'')}
      const code = raw.error_code ?? raw.errorCode;
      const msg = raw.error_msg ?? raw.errorMsg;

      if (code == null) return result === null;
      if (code === 0 || code === 1000000) return result === null;

      if (result == null) return false;
      if (typeof result.code !== 'string') return false;
      if (typeof result.message !== 'string') return false;
      if (result.code !== String(code)) return false;
      const expectedMsg = msg == null ? '' : String(msg);
      return result.message === expectedMsg;
    },
    { runs: 120 },
  );
});

// PBT 6.7b: non-object raw → always null (guardrail).
test('pbt: readBusinessError returns null for non-object input', async () => {
  await property(
    'non_object_input',
    gen.oneOf([null, undefined, 0, 1, 'string', true, false]),
    (raw) => readBusinessError(raw) === null,
    { runs: 20 },
  );
});

// PBT V0.2 #7: rate-limit cooldown state invariants.
// Randomize a sequence of rate-limit failures on one endpoint name and verify:
//   1. cooldownUntil is set IFF consecutiveFailures >= threshold
//   2. _cooldownRemainingMs reports > 0 IFF cooldownUntil is in the future
//   3. After cooldown expiry, state auto-clears on next probe
test('pbt: rate_limit_cooldown_monotonicity_and_gate', async () => {
  const threshold = _RATE_LIMIT_CONFIG.cooldownThreshold;
  await property(
    'cooldown_threshold_monotone',
    gen.int(0, threshold + 3), // vary failure count around threshold
    async (failures) => {
      _resetRateLimitState();
      const name = `pbt.cooldown.${failures}`;
      for (let i = 0; i < failures; i += 1) _recordRateLimitFailure(name);

      const remaining = _cooldownRemainingMs(name);
      const shouldCooldown = failures >= threshold;

      if (shouldCooldown) {
        if (remaining <= 0) return false;
        if (remaining > _RATE_LIMIT_CONFIG.cooldownMs) return false;
      } else if (remaining !== 0) {
        return false;
      }

      _resetRateLimitState();
      return true;
    },
    { runs: 30 },
  );
});

test('pbt: rate_limit_cooldown_expiry_auto_clears_state', async () => {
  const original = _RATE_LIMIT_CONFIG.cooldownMs;
  _RATE_LIMIT_CONFIG.cooldownMs = 10; // very short for PBT
  try {
    await property(
      'cooldown_expiry',
      gen.int(1, 3),
      async (extraFailures) => {
        _resetRateLimitState();
        const name = `pbt.cooldown.expiry.${extraFailures}`;
        const total = _RATE_LIMIT_CONFIG.cooldownThreshold + extraFailures - 1;
        for (let i = 0; i < total; i += 1) _recordRateLimitFailure(name);

        if (_cooldownRemainingMs(name) <= 0) return false;
        await new Promise((resolve) => setTimeout(resolve, 25));
        // After expiry, remaining must be exactly 0 and state must be auto-cleared.
        if (_cooldownRemainingMs(name) !== 0) return false;

        // Next single failure must start fresh (not immediately trigger cooldown again).
        _recordRateLimitFailure(name);
        const afterOneFreshFailure = _cooldownRemainingMs(name);
        _resetRateLimitState();
        return afterOneFreshFailure === 0;
      },
      { runs: 10 },
    );
  } finally {
    _RATE_LIMIT_CONFIG.cooldownMs = original;
    _resetRateLimitState();
  }
});
