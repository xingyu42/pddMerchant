import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { PlaywrightEndpointClient } from '../src/adapter/endpoint-client.js';
import { ORDER_LIST } from '../src/adapter/endpoints/orders.js';

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

function createPage(client) {
  const cache = client ? { request: { exports: client } } : {};
  const factories = {};
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
    for (const entry of tuple[2] ?? []) {
      const id = Array.isArray(entry) ? entry[0] : entry;
      webpackRequire(id);
    }
    return 1;
  };

  const page = {
    gotoCalls: 0,
    routeCalls: 0,
    url: () => 'https://mms.pinduoduo.com/home/',
    async goto() { this.gotoCalls += 1; },
    async route() { this.routeCalls += 1; },
    async evaluate(pageFunction, arg, world) {
      assert.equal(world, false);
      const previous = globalThis.window;
      globalThis.window = client ? { webpackJsonp: runtime } : {};
      try {
        if (!client && arg?.discovery) {
          arg.discovery = { attempts: 1, intervalMs: 0 };
        }
        return await pageFunction(arg);
      } finally {
        if (previous === undefined) delete globalThis.window;
        else globalThis.window = previous;
      }
    },
  };
  return page;
}

const baseSpec = {
  name: 'orders.test',
  strategy: 'page-api',
  apiUrl: '/api/orders',
  buildPayload: (params) => ({ pageNumber: params.page }),
  isSuccess: (raw) => raw?.success === true,
  normalize: (raw) => ({ total: raw.result.totalItemNum }),
};

function createClient(cooldownState = { map: new Map(), threshold: 3, ms: 300000 }) {
  return new PlaywrightEndpointClient({
    cooldownState,
  });
}

describe('PlaywrightEndpointClient page-api strategy', () => {
  test('executes and normalizes without navigation, routing, or XHR fallback', async () => {
    const page = createPage(createRequestClient(async () => ({ totalItemNum: 37 })));
    const result = await createClient().execute(baseSpec, { page: 2 }, { page });

    assert.deepEqual(result.data, { total: 37 });
    assert.equal(page.gotoCalls, 0);
    assert.equal(page.routeCalls, 0);
  });

  test('treats 40002 as an ambiguous business rejection, not confirmed rate limiting', async () => {
    const page = createPage(createRequestClient(async () => {
      throw { errorCode: 40002, errorMsg: '操作太过频繁' };
    }));

    const cooldownState = { map: new Map(), threshold: 3, ms: 300000 };
    await assert.rejects(
      () => createClient(cooldownState).execute(baseSpec, {}, { page }),
      (error) => error.code === 'E_BUSINESS'
        && error.detail?.classification === 'high-frequency-or-risk-control'
        && error.detail?.raw?.errorCode === 40002,
    );
    assert.equal(cooldownState.map.size, 0);
  });

  test('maps a page request rejection without a business code to E_NETWORK', async () => {
    const page = createPage(createRequestClient(async () => {
      throw new TypeError('socket closed');
    }));

    await assert.rejects(
      () => createClient().execute(baseSpec, {}, { page }),
      (error) => error.code === 'E_NETWORK' && error.exitCode === 5,
    );
  });

  test('maps a Playwright main-world evaluation failure to E_NETWORK', async () => {
    const page = createPage(createRequestClient(async () => ({ totalItemNum: 1 })));
    page.evaluate = async () => {
      throw new Error('Execution context was destroyed');
    };

    await assert.rejects(
      () => createClient().execute(baseSpec, {}, { page }),
      (error) => error.code === 'E_NETWORK' && error.exitCode === 5,
    );
  });

  test('stops a hanging page API request when the command deadline expires', async () => {
    const page = createPage(createRequestClient(async () => ({ totalItemNum: 1 })));
    page.evaluate = () => new Promise(() => {});

    await assert.rejects(
      () => createClient().execute(baseSpec, {}, { page, deadlineAt: Date.now() + 5 }),
      (error) => error.code === 'E_TIMEOUT' && error.exitCode === 5,
    );
  });

  test('stops a hanging page API request when the command signal aborts', async () => {
    const page = createPage(createRequestClient(async () => ({ totalItemNum: 1 })));
    page.evaluate = () => new Promise(() => {});
    const controller = new AbortController();
    const pending = createClient().execute(baseSpec, {}, { page, signal: controller.signal });
    setTimeout(() => controller.abort(), 0);

    await assert.rejects(
      () => pending,
      (error) => error.code === 'E_TIMEOUT' && error.exitCode === 5,
    );
  });

  test('exposes a response-compatible surface to errorMapper for full envelopes', async () => {
    const page = createPage(createRequestClient(async () => ({
      success: false,
      errorCode: 12345,
      errorMsg: 'business failure',
    })));
    let responseContract;
    const spec = {
      ...baseSpec,
      errorMapper: (_raw, response) => {
        responseContract = {
          status: response.status(),
          ok: response.ok(),
          url: response.url(),
          headers: response.headers(),
        };
        return { code: 'E_CUSTOM', message: 'mapped', exitCode: 6 };
      },
    };

    await assert.rejects(
      () => createClient().execute(spec, {}, { page }),
      (error) => error.code === 'E_CUSTOM',
    );
    assert.deepEqual(responseContract, {
      status: 200,
      ok: true,
      url: 'https://mms.pinduoduo.com/api/orders',
      headers: { 'content-type': 'application/json' },
    });
  });

  test('maps an incomplete explicit page-api spec to E_USAGE', async () => {
    const page = createPage(createRequestClient(async () => ({})));

    await assert.rejects(
      () => createClient().execute({ ...baseSpec, buildPayload: undefined }, {}, { page }),
      (error) => error.code === 'E_USAGE',
    );
    await assert.rejects(
      () => createClient().execute({ ...baseSpec, apiUrl: '' }, {}, { page }),
      (error) => error.code === 'E_USAGE',
    );
  });

  test('does not normalize an unknown order-list result shape into zero orders', async () => {
    const page = createPage(createRequestClient(async () => ({})));

    await assert.rejects(
      () => createClient().execute(ORDER_LIST, {}, { page }),
      (error) => error.code === 'E_NETWORK'
        && error.message.includes('unexpected response shape'),
    );
  });

  test('fails explicitly when the page request client is unavailable', async () => {
    const page = createPage(null);

    await assert.rejects(
      () => createClient().execute(baseSpec, {}, { page }),
      (error) => error.code === 'E_NETWORK'
        && error.message.includes('page API client unavailable'),
    );
    assert.equal(page.gotoCalls, 0);
    assert.equal(page.routeCalls, 0);
  });
});
