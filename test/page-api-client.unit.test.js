import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { executePageApiRequest } from '../src/adapter/page-api-client.js';

function createWebpackRuntime(exportsById) {
  const cache = {};
  const factories = {};
  for (const [id, exports] of Object.entries(exportsById)) {
    cache[id] = { exports };
  }
  const webpackRequire = (id) => {
    if (cache[id]) return cache[id].exports;
    const module = { exports: {} };
    cache[id] = module;
    factories[id]?.(module, module.exports, webpackRequire);
    return module.exports;
  };
  webpackRequire.c = cache;
  webpackRequire.m = factories;

  const runtime = [];
  runtime.push = (tuple) => {
    const modules = tuple[1] ?? {};
    Object.assign(factories, modules);
    const entries = tuple[2] ?? [];
    for (const entry of entries) {
      const id = Array.isArray(entry) ? entry[0] : entry;
      webpackRequire(id);
    }
    return 1;
  };
  runtime.webpackRequire = webpackRequire;
  return runtime;
}

function createWebpack5Runtime(exportsById) {
  const cache = Object.fromEntries(
    Object.entries(exportsById).map(([id, exports]) => [id, { exports }]),
  );
  const webpackRequire = (id) => cache[id]?.exports;
  webpackRequire.c = cache;
  webpackRequire.m = {};

  const runtime = [];
  runtime.push = (tuple) => {
    const runtimeCallback = tuple[2];
    if (typeof runtimeCallback === 'function') runtimeCallback(webpackRequire);
    return 1;
  };
  return runtime;
}

function createPage(windowValue) {
  return {
    async evaluate(pageFunction, arg, world) {
      assert.equal(world, false);
      const previous = globalThis.window;
      globalThis.window = windowValue;
      try {
        return await pageFunction(arg);
      } finally {
        if (previous === undefined) delete globalThis.window;
        else globalThis.window = previous;
      }
    },
  };
}

function createRequestClient(post) {
  return {
    fetch() {},
    post,
    get() {},
    put() {},
    del() {},
    redirectToLogin() {},
  };
}

describe('executePageApiRequest', () => {
  test('uses the page request client and wraps its unwrapped result', async () => {
    const calls = [];
    const client = createRequestClient(async (url, payload) => {
      calls.push({ url, payload });
      return { totalItemNum: 37, pageItems: [{ goods_id: 1 }] };
    });
    const page = createPage({ webpackJsonp: createWebpackRuntime({ http: client }) });

    const result = await executePageApiRequest(page, {
      apiUrl: '/mangkhut/mms/recentOrderList',
      payload: { pageNumber: 2, pageSize: 20 },
    });

    assert.deepEqual(calls, [{
      url: '/mangkhut/mms/recentOrderList',
      payload: { pageNumber: 2, pageSize: 20 },
    }]);
    assert.deepEqual(result, {
      status: 200,
      raw: {
        success: true,
        errorCode: 0,
        result: { totalItemNum: 37, pageItems: [{ goods_id: 1 }] },
      },
    });
  });

  test('preserves a complete success envelope without nesting result twice', async () => {
    const envelope = {
      success: true,
      errorCode: 0,
      result: { totalItemNum: 37, pageItems: [] },
    };
    const client = createRequestClient(async () => envelope);
    const page = createPage({ webpackJsonp: createWebpackRuntime({ http: client }) });

    const result = await executePageApiRequest(page, {
      apiUrl: '/mangkhut/mms/recentOrderList',
      payload: {},
    });

    assert.deepEqual(result, { status: 200, raw: envelope });
    assert.equal(result.raw.result?.result, undefined);
  });

  test('preserves a complete failure envelope returned by the page client', async () => {
    const envelope = { success: false, error_code: 1000, error_msg: 'missing input' };
    const client = createRequestClient(async () => envelope);
    const page = createPage({ webpackJsonp: createWebpackRuntime({ http: client }) });

    const result = await executePageApiRequest(page, {
      apiUrl: '/mangkhut/mms/orderDetail',
      payload: {},
    });

    assert.deepEqual(result, { status: 200, raw: envelope });
  });

  test('returns a safe business error without raw sensitive fields', async () => {
    const client = createRequestClient(async () => {
      throw { errorCode: 40002, errorMsg: '操作太过频繁', mobile: 'sensitive' };
    });
    const page = createPage({ webpackJsonp: createWebpackRuntime({ http: client }) });

    const result = await executePageApiRequest(page, {
      apiUrl: '/mangkhut/mms/recentOrderList',
      payload: {},
    });

    assert.deepEqual(result, {
      status: 200,
      raw: { success: false, errorCode: 40002, errorMsg: '操作太过频繁' },
    });
  });

  test('classifies a client rejection without a business code as a transport error', async () => {
    const client = createRequestClient(async () => {
      throw new TypeError('socket closed');
    });
    const page = createPage({ webpackJsonp: createWebpackRuntime({ http: client }) });

    const result = await executePageApiRequest(page, {
      apiUrl: '/mangkhut/mms/recentOrderList',
      payload: {},
    });

    assert.deepEqual(result, {
      status: null,
      raw: null,
      transportError: true,
      message: 'socket closed',
    });
  });

  test('stops a hanging main-world evaluation at the supplied deadline', async () => {
    const page = { evaluate: () => new Promise(() => {}) };

    await assert.rejects(
      () => executePageApiRequest(page, {
        apiUrl: '/api/test',
        payload: {},
      }, { timeoutMs: 5 }),
      (error) => error.code === 'E_TIMEOUT',
    );
  });

  test('reports unavailable runtime without falling back to XHR', async () => {
    const page = createPage({});
    const result = await executePageApiRequest(page, {
      apiUrl: '/api/test',
      payload: {},
      discovery: { attempts: 1, intervalMs: 0 },
    });

    assert.deepEqual(result, {
      status: null,
      raw: null,
      unavailable: true,
      reason: 'runtime-not-found',
    });
  });

  test('waits for a delayed Webpack runtime and does not write a window cache', async () => {
    const client = createRequestClient(async () => ({ value: 1 }));
    const windowValue = {};
    const page = createPage(windowValue);
    setTimeout(() => {
      windowValue.webpackJsonp = createWebpackRuntime({ http: client });
    }, 0);

    const result = await executePageApiRequest(page, {
      apiUrl: '/api/test',
      payload: {},
      discovery: { attempts: 3, intervalMs: 1 },
    });

    assert.equal(result.raw.result.value, 1);
    assert.equal(windowValue.__pddCliMmsRequestClient, undefined);
    assert.deepEqual(
      Object.keys(windowValue.webpackJsonp.webpackRequire.c),
      ['http'],
      'temporary probe module must be removed from the module cache',
    );
  });

  test('supports the standard Webpack 5 webpackChunk runtime callback', async () => {
    const client = createRequestClient(async () => ({ value: 2 }));
    const page = createPage({ webpackChunkmms: createWebpack5Runtime({ http: client }) });

    const result = await executePageApiRequest(page, {
      apiUrl: '/api/test',
      payload: {},
      discovery: { attempts: 1, intervalMs: 0 },
    });

    assert.equal(result.raw.result.value, 2);
  });

  test('distinguishes an incompatible runtime push contract', async () => {
    const incompatibleRuntime = [];
    incompatibleRuntime.push = () => { throw new Error('unsupported tuple'); };
    const page = createPage({ webpackChunkunknown: incompatibleRuntime });

    const result = await executePageApiRequest(page, {
      apiUrl: '/api/test',
      payload: {},
      discovery: { attempts: 1, intervalMs: 0 },
    });

    assert.equal(result.reason, 'runtime-shape-mismatch');
  });
});
