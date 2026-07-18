import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import {
  runEndpoint,
  _resetRateLimitState,
} from '../src/adapter/run-endpoint.js';
import { getSharedClient } from '../src/adapter/rate-limiter-singleton.js';
import { TEST_RUNTIME_CONFIG } from './helpers/runtime-config.js';

getSharedClient(TEST_RUNTIME_CONFIG);

function createFakePage({ respondBy } = {}) {
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
      const curr = attempt++;
      queueMicrotask(() => {
        const resp = respondBy(url, curr);
        const response = {
          url: () => url,
          status: () => resp.status ?? 200,
          text: async () => (typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body)),
          json: async () => resp.body,
        };
        for (const l of listeners.slice()) l(response);
      });
    },
    async waitForSelector() {},
    url: () => 'http://fake/current',
  };
}

const PATTERN = /\/fake\/endpoint/;

// INV-013: Error-code mapping stability
// Contract: HTTP status codes map to stable error codes and exit codes.
describe('error-code mapping stability', () => {
  test('HTTP 401 -> E_AUTH_EXPIRED (exitCode 3)', async () => {
    _resetRateLimitState();
    const page = createFakePage({
      respondBy: () => ({ status: 401, body: {} }),
    });
    const meta = {
      name: 'test.map.401',
      urlPattern: PATTERN,
      nav: { url: 'http://host/fake/endpoint' },
      isSuccess: () => true,
    };

    await assert.rejects(
      () => runEndpoint(page, meta, {}, {}),
      (err) => err.code === 'E_AUTH_EXPIRED' && err.exitCode === 3,
    );
    _resetRateLimitState();
  });

  test('HTTP 403 -> E_AUTH_EXPIRED (exitCode 3)', async () => {
    _resetRateLimitState();
    const page = createFakePage({
      respondBy: () => ({ status: 403, body: {} }),
    });
    const meta = {
      name: 'test.map.403',
      urlPattern: PATTERN,
      nav: { url: 'http://host/fake/endpoint' },
      isSuccess: () => true,
    };

    await assert.rejects(
      () => runEndpoint(page, meta, {}, {}),
      (err) => err.code === 'E_AUTH_EXPIRED' && err.exitCode === 3,
    );
    _resetRateLimitState();
  });

  test('HTTP 429 after retries -> E_RATE_LIMIT (exitCode 4)', { timeout: 30000 }, async () => {
    _resetRateLimitState();
    let attempts = 0;
    const page = createFakePage({
      respondBy: () => {
        attempts += 1;
        return { status: 429, body: {} };
      },
    });
    const meta = {
      name: 'test.map.429',
      urlPattern: PATTERN,
      nav: { url: 'http://host/fake/endpoint' },
      isSuccess: () => true,
    };

    await assert.rejects(
      () => runEndpoint(page, meta, {}, {}),
      (err) => err.code === 'E_RATE_LIMIT' && err.exitCode === 4,
    );

    assert.equal(attempts, 4, 'should attempt 1 initial + 3 retries = 4 total');
    _resetRateLimitState();
  });

  test('business error (isSuccess=false) -> E_BUSINESS (exitCode 6)', async () => {
    _resetRateLimitState();
    const page = createFakePage({
      respondBy: () => ({ status: 200, body: { success: false, error_code: 9999, error_msg: 'test error' } }),
    });
    const meta = {
      name: 'test.map.business',
      urlPattern: PATTERN,
      nav: { url: 'http://host/fake/endpoint' },
      isSuccess: (raw) => raw?.success === true,
    };

    await assert.rejects(
      () => runEndpoint(page, meta, {}, {}),
      (err) => err.code === 'E_BUSINESS' && err.exitCode === 6 && err.message.includes('test error'),
    );
    _resetRateLimitState();
  });
});
