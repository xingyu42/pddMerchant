import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { executePageApiRequest } from '../../src/adapter/page-api-client.js';
import { normalizePageApiMethod } from '../../src/adapter/endpoint-strategy-resolver.js';

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

function installWebpackChunkWindow(client) {
  const webpackRequire = {
    c: { reqMod: { exports: client } },
    m: {},
  };
  const runtime = [];
  runtime.push = (entry) => {
    const callback = entry[2];
    if (typeof callback === 'function') callback(webpackRequire);
  };
  Object.defineProperty(globalThis, 'window', {
    value: { webpackChunk_test: runtime },
    configurable: true,
    writable: true,
  });
}

function fakePage() {
  return {
    evaluate(fn, arg) {
      return fn(arg);
    },
  };
}

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  } else {
    delete globalThis.window;
  }
});

describe('normalizePageApiMethod', () => {
  it('accepts GET and POST case-insensitively and defaults omitted method to POST', () => {
    assert.equal(normalizePageApiMethod(), 'POST');
    assert.equal(normalizePageApiMethod('get'), 'GET');
    assert.equal(normalizePageApiMethod('Post'), 'POST');
    assert.equal(normalizePageApiMethod('DELETE'), null);
    assert.equal(normalizePageApiMethod(123), null);
  });
});

describe('executePageApiRequest', () => {
  it('dispatches GET requests via client.get and POST requests via client.post', async () => {
    const get = vi.fn(async () => ({ unreply_num: 2 }));
    const post = vi.fn(async () => ({ success: true, errorCode: 1000000, result: { total: 24, list: [] } }));
    const client = {
      fetch: vi.fn(),
      get,
      post,
      put: vi.fn(),
      del: vi.fn(),
      redirectToLogin: vi.fn(),
    };
    installWebpackChunkWindow(client);

    const getRes = await executePageApiRequest(fakePage(), {
      apiUrl: '/chats/cs/unreplyUser/count',
      method: 'GET',
      payload: {},
    });
    assert.equal(getRes.status, 200);
    assert.deepEqual(getRes.raw, { success: true, errorCode: 0, result: { unreply_num: 2 } });
    assert.deepEqual(get.mock.calls, [['/chats/cs/unreplyUser/count']]);
    assert.equal(post.mock.calls.length, 0);

    const postRes = await executePageApiRequest(fakePage(), {
      apiUrl: '/desert/stat/getMallHourConsultData',
      payload: { startDate: '2026-11-22', endDate: '2026-11-22' },
    });
    assert.equal(postRes.status, 200);
    assert.deepEqual(postRes.raw, { success: true, errorCode: 1000000, result: { total: 24, list: [] } });
    assert.deepEqual(post.mock.calls, [
      ['/desert/stat/getMallHourConsultData', { startDate: '2026-11-22', endDate: '2026-11-22' }],
    ]);
  });

  it('maps GET business rejections cleanly and reports missing runtime when absent', async () => {
    const client = {
      fetch: vi.fn(),
      get: vi.fn(async () => {
        const err = new Error('rejected');
        err.errorCode = 40002;
        err.errorMsg = '请求失败';
        throw err;
      }),
      post: vi.fn(),
      put: vi.fn(),
      del: vi.fn(),
      redirectToLogin: vi.fn(),
    };
    installWebpackChunkWindow(client);

    const rejected = await executePageApiRequest(fakePage(), {
      apiUrl: '/desert/stat/mallServiceRealTimeData',
      method: 'GET',
      payload: {},
    });
    assert.deepEqual(rejected, {
      status: 200,
      raw: { success: false, errorCode: 40002, errorMsg: '请求失败' },
    });

    Object.defineProperty(globalThis, 'window', { value: {}, configurable: true, writable: true });
    const unavailable = await executePageApiRequest(fakePage(), {
      apiUrl: '/desert/stat/mallServiceRealTimeData',
      method: 'GET',
      payload: {},
      discovery: { attempts: 1, intervalMs: 0 },
    });
    assert.deepEqual(unavailable, {
      status: null,
      raw: null,
      unavailable: true,
      reason: 'runtime-not-found',
    });
  });
});
