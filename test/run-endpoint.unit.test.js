import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runEndpoint,
  readBusinessError,
  _resetRateLimitState,
  _recordRateLimitFailure,
  _cooldownRemainingMs,
  _RATE_LIMIT_CONFIG,
} from '../src/adapter/run-endpoint.js';

function createFakePage({ respondBy, navSelector = true, navSucceeds = true } = {}) {
  const listeners = [];
  let attempt = 0;
  return {
    on(evt, fn) { if (evt === 'response') listeners.push(fn); },
    off(evt, fn) {
      if (evt !== 'response') return;
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    async goto(url) {
      if (!navSucceeds) throw new Error('nav failed');
      const curr = attempt++;
      queueMicrotask(() => {
        const resp = respondBy ? respondBy(url, curr) : { status: 200, body: { success: true, errorCode: 0, result: {} } };
        const response = {
          url: () => url,
          status: () => resp.status ?? 200,
          text: async () => (typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body)),
          json: async () => resp.body,
        };
        for (const l of listeners.slice()) l(response);
      });
    },
    async waitForSelector() {
      if (!navSelector) throw new Error('no selector');
    },
    url: () => 'http://fake/current',
  };
}

const PATTERN = /\/fake\/endpoint/;

test('function-form nav.url is evaluated exactly once per runEndpoint call', async () => {
  let calls = 0;
  const page = createFakePage();
  const meta = {
    name: 'test.navFn',
    urlPattern: PATTERN,
    nav: {
      url: (params, ctx) => {
        calls += 1;
        return `http://host/fake/endpoint?sn=${params.sn}&mall=${ctx.mallId}`;
      },
    },
    isSuccess: () => true,
  };
  await runEndpoint(page, meta, { sn: 'abc' }, { mallId: '445301049' });
  assert.equal(calls, 1);
});

test('errorMapper maps business error code on non-success body', async () => {
  const page = createFakePage({
    respondBy: () => ({ status: 200, body: { success: false, error_code: 1000, error_msg: '订单号不能为空' } }),
  });
  const meta = {
    name: 'test.errMap',
    urlPattern: PATTERN,
    nav: { url: 'http://host/fake/endpoint' },
    isSuccess: (raw) => raw?.success === true,
    errorMapper: (raw) => {
      if (raw?.error_code === 1000) return { code: 'E_USAGE', message: raw.error_msg };
      return null;
    },
  };
  await assert.rejects(
    () => runEndpoint(page, meta, {}, {}),
    (err) => err.code === 'E_USAGE' && err.exitCode === 2 && err.message.includes('订单号不能为空'),
  );
});

test('errorMapper-mapped E_RATE_LIMIT produces exitCode 4 (not 6/BUSINESS)', async () => {
  const page = createFakePage({
    respondBy: () => ({ status: 200, body: { success: false, error_code: 54001, error_msg: '操作太过频繁' } }),
  });
  const meta = {
    name: 'test.errMapRate',
    urlPattern: PATTERN,
    nav: { url: 'http://host/fake/endpoint' },
    isSuccess: (raw) => raw?.success === true,
    errorMapper: (raw) => {
      if (raw?.error_code === 54001) return { code: 'E_RATE_LIMIT', message: raw.error_msg };
      return null;
    },
  };
  await assert.rejects(
    () => runEndpoint(page, meta, {}, {}),
    (err) => err.code === 'E_RATE_LIMIT' && err.exitCode === 4,
  );
});

test('errorMapper.exitCode explicit overrides mapErrorToExit inference', async () => {
  const page = createFakePage({
    respondBy: () => ({ status: 200, body: { success: false, error_code: 9999 } }),
  });
  const meta = {
    name: 'test.errMapExplicit',
    urlPattern: PATTERN,
    nav: { url: 'http://host/fake/endpoint' },
    isSuccess: (raw) => raw?.success === true,
    errorMapper: () => ({ code: 'E_CUSTOM', message: 'custom', exitCode: 7 }),
  };
  await assert.rejects(
    () => runEndpoint(page, meta, {}, {}),
    (err) => err.code === 'E_CUSTOM' && err.exitCode === 7,
  );
});

test('HTTP 404 + empty body still reaches errorMapper (not early E_NETWORK)', async () => {
  const page = createFakePage({
    respondBy: () => ({ status: 404, body: null }),
  });
  const meta = {
    name: 'test.http404',
    urlPattern: PATTERN,
    nav: { url: 'http://host/fake/endpoint' },
    isSuccess: () => true,
    errorMapper: (_raw, response) => {
      const status = typeof response?.status === 'function' ? response.status() : response?.status;
      if (status === 404) return { code: 'E_NOT_FOUND', message: 'order not found' };
      return null;
    },
  };
  await assert.rejects(
    () => runEndpoint(page, meta, {}, {}),
    (err) => err.code === 'E_NOT_FOUND' && err.message.includes('order not found'),
  );
});

test('requiredTrigger: trigger exception rejects immediately with PddCliError', async () => {
  const page = createFakePage();
  const meta = {
    name: 'test.requiredTrigger',
    urlPattern: PATTERN,
    nav: { url: 'http://host/fake/endpoint' },
    requiredTrigger: true,
    trigger: async () => { throw new Error('boom'); },
    isSuccess: () => true,
  };
  await assert.rejects(
    () => runEndpoint(page, meta, {}, {}),
    (err) => err.code === 'E_GENERAL' && err.message.includes('required trigger failed'),
  );
});

test('requiredTrigger unset: trigger exception is swallowed, XHR still collected', async () => {
  const page = createFakePage();
  const meta = {
    name: 'test.optionalTrigger',
    urlPattern: PATTERN,
    nav: { url: 'http://host/fake/endpoint' },
    trigger: async () => { throw new Error('swallowed'); },
    isSuccess: () => true,
  };
  const result = await runEndpoint(page, meta, {}, {});
  assert.ok(result, 'runEndpoint must resolve (not reject) when trigger is optional');
  assert.equal(typeof result, 'object', 'result must be an object (XHR collected)');
  // without normalize fn, runEndpoint wraps as { raw: <body> }
  assert.ok(result.raw, 'result.raw must contain the XHR response body');
  assert.equal(result.raw.success, true, 'collected XHR body must have success field');
});

test('429 retries with exponential backoff [1000, 2000, 4000] then succeeds', async () => {
  const statuses = [429, 429, 200];
  let idx = 0;
  const page = createFakePage({
    respondBy: () => {
      const s = statuses[Math.min(idx, statuses.length - 1)];
      idx += 1;
      return { status: s, body: { success: true, errorCode: 0, result: {} } };
    },
  });
  const meta = {
    name: 'test.retry',
    urlPattern: PATTERN,
    nav: { url: 'http://host/fake/endpoint' },
    isSuccess: () => true,
  };
  const t0 = Date.now();
  await runEndpoint(page, meta, {}, {});
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 3000, `expected elapsed >= 3000ms (1000 + 2000 backoff), got ${elapsed}ms`);
  assert.ok(elapsed < 7500, `expected elapsed < 7500ms, got ${elapsed}ms`);
  assert.equal(idx, 3, 'page should respond exactly 3 times');
});

test('function-form nav.url is evaluated ONLY once even across 429 retries (W1)', async () => {
  let calls = 0;
  const statuses = [429, 200];
  let idx = 0;
  const page = createFakePage({
    respondBy: () => {
      const s = statuses[Math.min(idx, statuses.length - 1)];
      idx += 1;
      return { status: s, body: { success: true, errorCode: 0, result: {} } };
    },
  });
  const meta = {
    name: 'test.navFnRetryOnce',
    urlPattern: PATTERN,
    nav: {
      url: () => {
        calls += 1;
        return 'http://host/fake/endpoint?t=' + calls;
      },
    },
    isSuccess: () => true,
  };
  await runEndpoint(page, meta, {}, {});
  assert.equal(calls, 1, `nav.url fn must be evaluated exactly once even with 1 retry; got ${calls}`);
  assert.equal(idx, 2, 'page should respond exactly 2 times (1 initial + 1 retry)');
});

test('429 exhausts retries and rejects with E_RATE_LIMIT', async () => {
  const page = createFakePage({
    respondBy: () => ({ status: 429, body: { error_code: 54001, error_msg: '操作太过频繁' } }),
  });
  const meta = {
    name: 'test.retryExhausted',
    urlPattern: PATTERN,
    nav: { url: 'http://host/fake/endpoint' },
    isSuccess: () => true,
  };
  await assert.rejects(
    () => runEndpoint(page, meta, {}, {}),
    (err) => err.code === 'E_RATE_LIMIT' && err.exitCode === 4,
  );
}, { timeout: 30000 });

test('401 rejects with E_AUTH_EXPIRED immediately (no retry)', async () => {
  const page = createFakePage({
    respondBy: () => ({ status: 401, body: {} }),
  });
  const meta = {
    name: 'test.auth',
    urlPattern: PATTERN,
    nav: { url: 'http://host/fake/endpoint' },
    isSuccess: () => true,
  };
  await assert.rejects(
    () => runEndpoint(page, meta, {}, {}),
    (err) => err.code === 'E_AUTH_EXPIRED' && err.exitCode === 3,
  );
});

test('readBusinessError: snake_case / camelCase / success sentinels', () => {
  assert.equal(readBusinessError(null), null);
  assert.equal(readBusinessError({}), null);
  assert.equal(readBusinessError({ error_code: 0, error_msg: 'ok' }), null);
  assert.equal(readBusinessError({ errorCode: 1000000, errorMsg: '成功' }), null);

  assert.deepEqual(
    readBusinessError({ error_code: 1000, error_msg: '订单号不能为空' }),
    { code: '1000', message: '订单号不能为空' },
  );
  assert.deepEqual(
    readBusinessError({ errorCode: 54001, errorMsg: '操作太过频繁' }),
    { code: '54001', message: '操作太过频繁' },
  );
  // prefer snake_case when both present (real PDD endpoints use one or the other exclusively)
  const mixed = readBusinessError({ error_code: 2001, errorCode: 9999, error_msg: 'snake', errorMsg: 'camel' });
  assert.equal(mixed.code, '2001');
  assert.equal(mixed.message, 'snake');
});

test('backward compat: endpoint without errorMapper/requiredTrigger/fn-nav-url behaves as V0', async () => {
  const page = createFakePage({
    respondBy: () => ({ status: 200, body: { success: true, errorCode: 0, result: { items: [1, 2, 3] } } }),
  });
  const meta = {
    name: 'test.v0Compat',
    urlPattern: PATTERN,
    nav: { url: 'http://host/fake/endpoint', waitUntil: 'domcontentloaded' },
    isSuccess: (raw) => raw?.success === true,
    normalize: (raw) => ({ items: raw.result.items, raw }),
  };
  const result = await runEndpoint(page, meta, {}, {});
  assert.deepEqual(result.items, [1, 2, 3]);
});

test('V0.2 #7 cooldown: threshold failures trigger gate and short-circuit page.goto', async () => {
  _resetRateLimitState();
  const name = 'test.cooldown.gate';

  // Simulate 3 consecutive rate-limit failures (threshold reached).
  for (let i = 0; i < _RATE_LIMIT_CONFIG.cooldownThreshold; i += 1) _recordRateLimitFailure(name);
  assert.ok(_cooldownRemainingMs(name) > 0, 'cooldownUntil should be set after threshold failures');

  let gotoCalls = 0;
  const page = {
    on() { /* noop */ },
    off() { /* noop */ },
    async goto() { gotoCalls += 1; },
    async waitForSelector() { /* noop */ },
    url: () => 'http://fake/cooldown',
  };
  const meta = {
    name,
    urlPattern: PATTERN,
    nav: { url: 'http://host/fake/endpoint' },
    isSuccess: () => true,
  };

  await assert.rejects(
    () => runEndpoint(page, meta, {}, {}),
    (err) => err.code === 'E_RATE_LIMIT'
      && err.exitCode === 4
      && err.detail?.cooldown_triggered === true
      && err.detail?.cooldown_remaining_ms > 0,
  );
  assert.equal(gotoCalls, 0, 'cooldown gate MUST short-circuit before page.goto');

  _resetRateLimitState();
});

test('V0.2 #7 cooldown: successful call resets consecutive failure count', async () => {
  _resetRateLimitState();
  const name = 'test.cooldown.reset';

  // Record 2 failures (under threshold — no cooldown yet).
  _recordRateLimitFailure(name);
  _recordRateLimitFailure(name);
  assert.equal(_cooldownRemainingMs(name), 0, 'cooldown MUST NOT trigger below threshold');

  const page = createFakePage(); // defaults to success
  const meta = {
    name,
    urlPattern: PATTERN,
    nav: { url: 'http://host/fake/endpoint' },
    isSuccess: () => true,
  };
  await runEndpoint(page, meta, {}, {});

  // After success, failure state should be cleared — a third 429 should NOT immediately cooldown.
  _recordRateLimitFailure(name);
  assert.equal(_cooldownRemainingMs(name), 0, 'post-success single failure MUST NOT cooldown');

  _resetRateLimitState();
});

test('V0.2 #7 cooldown: expired cooldown auto-clears state and allows new call', async () => {
  _resetRateLimitState();
  const name = 'test.cooldown.expiry';
  const originalMs = _RATE_LIMIT_CONFIG.cooldownMs;
  _RATE_LIMIT_CONFIG.cooldownMs = 30; // 30ms cooldown for fast test

  try {
    // Trigger cooldown
    for (let i = 0; i < _RATE_LIMIT_CONFIG.cooldownThreshold; i += 1) _recordRateLimitFailure(name);
    assert.ok(_cooldownRemainingMs(name) > 0);

    // Wait for cooldown to elapse
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Now remaining should be 0 AND state should be cleared
    assert.equal(_cooldownRemainingMs(name), 0, 'expired cooldown MUST return 0');

    // Next call should proceed (not gated)
    const page = createFakePage();
    const meta = {
      name,
      urlPattern: PATTERN,
      nav: { url: 'http://host/fake/endpoint' },
      isSuccess: () => true,
    };
    await runEndpoint(page, meta, {}, {}); // should NOT throw
  } finally {
    _RATE_LIMIT_CONFIG.cooldownMs = originalMs;
    _resetRateLimitState();
  }
});
