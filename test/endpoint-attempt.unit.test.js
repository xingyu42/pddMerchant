import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { executeAttempt } from '../src/adapter/endpoint-attempt.js';
import { _resetCollectorState } from '../src/adapter/xhr-collector.js';

function createMockPage({ navSucceeds = true, readyElSucceeds = true, responses = [] } = {}) {
  const listeners = { response: [], request: [] };
  return {
    on(evt, fn) {
      if (listeners[evt]) listeners[evt].push(fn);
    },
    off(evt, fn) {
      if (!listeners[evt]) return;
      const i = listeners[evt].indexOf(fn);
      if (i >= 0) listeners[evt].splice(i, 1);
    },
    async goto(url) {
      if (!navSucceeds) throw new Error('navigation failed');
      queueMicrotask(() => {
        for (const resp of responses) {
          for (const l of listeners.response.slice()) l(resp);
        }
      });
    },
    async waitForSelector() {
      if (!readyElSucceeds) throw new Error('selector not found');
    },
    url: () => 'http://fake',
  };
}

function createMockResponse(url = 'http://fake/api/test', status = 200) {
  return {
    url: () => url,
    status: () => status,
    request: () => null,
    text: async () => JSON.stringify({ success: true }),
    json: async () => ({ success: true }),
  };
}

describe('executeAttempt', () => {
  test('successful attempt returns first response', async () => {
    _resetCollectorState();
    const mockResp = createMockResponse('http://fake/api/test', 200);
    const page = createMockPage({ responses: [mockResp] });

    let prepareCalled = false;
    let cleanupCalled = false;

    const response = await executeAttempt({
      page,
      meta: {
        name: 'test.success',
        urlPattern: /api\/test/,
        nav: { url: 'http://fake/api/test' },
      },
      params: {},
      ctx: {},
      log: { debug: () => {} },
      navUrl: 'http://fake/api/test',
      pageSession: null,
      prepareTransport: async () => { prepareCalled = true; },
      cleanupTransport: async () => { cleanupCalled = true; },
      runTrigger: async () => {},
    });

    assert.ok(response);
    assert.equal(response.status(), 200);
    assert.ok(prepareCalled, 'prepareTransport should be called');
    assert.ok(cleanupCalled, 'cleanupTransport should be called in finally');
  });

  test('page session selects the attempt page before transport and collection setup', async () => {
    _resetCollectorState();
    const mockResp = createMockResponse('http://fake/api/test', 200);
    const originalPage = createMockPage();
    const siblingPage = createMockPage({ responses: [mockResp] });
    const seen = { prepared: null, triggered: null, cleaned: null };
    const pageSession = {
      async selectPage(page, url) {
        assert.equal(page, originalPage);
        assert.equal(url, 'http://fake/api/test');
        return siblingPage;
      },
      recordNavigation(page, url) {
        assert.equal(page, siblingPage);
        assert.equal(url, 'http://fake/api/test');
      },
    };

    const response = await executeAttempt({
      page: originalPage,
      meta: {
        name: 'test.siblingPage',
        urlPattern: /api\/test/,
        nav: { url: 'http://fake/api/test' },
      },
      params: {},
      ctx: {},
      log: { debug: () => {} },
      navUrl: 'http://fake/api/test',
      pageSession,
      prepareTransport: async (page) => { seen.prepared = page; },
      cleanupTransport: async (page) => { seen.cleaned = page; },
      runTrigger: async (_meta, page) => { seen.triggered = page; },
    });

    assert.equal(response, mockResp);
    assert.equal(seen.prepared, siblingPage);
    assert.equal(seen.triggered, siblingPage);
    assert.equal(seen.cleaned, siblingPage);
  });

  test('navigation failure wraps as E_NETWORK and calls cleanup', async () => {
    _resetCollectorState();
    const page = createMockPage({ navSucceeds: false });

    let cleanupCalled = false;

    await assert.rejects(
      () => executeAttempt({
        page,
        meta: {
          name: 'test.navFail',
          urlPattern: /test/,
          nav: { url: 'http://fake/test' },
        },
        params: {},
        ctx: {},
        log: { debug: () => {} },
        navUrl: 'http://fake/test',
        pageSession: null,
        prepareTransport: async () => {},
        cleanupTransport: async () => { cleanupCalled = true; },
        runTrigger: async () => {},
      }),
      (err) => err.code === 'E_NETWORK',
    );

    assert.ok(cleanupCalled, 'cleanupTransport should be called even on failure');
  });

  test('readyEl failure is non-fatal', async () => {
    _resetCollectorState();
    const mockResp = createMockResponse('http://fake/test', 200);
    const page = createMockPage({ readyElSucceeds: false, responses: [mockResp] });

    let debugMessages = [];

    const response = await executeAttempt({
      page,
      meta: {
        name: 'test.noReadyEl',
        urlPattern: /test/,
        nav: { url: 'http://fake/test', readyEl: '.missing' },
      },
      params: {},
      ctx: {},
      log: { debug: (...args) => { debugMessages.push(args); } },
      navUrl: 'http://fake/test',
      pageSession: null,
      prepareTransport: async () => {},
      cleanupTransport: async () => {},
      runTrigger: async () => {},
    });

    assert.ok(response, 'should succeed even if readyEl not found');
    assert.equal(response.status(), 200);
    assert.ok(
      debugMessages.some((args) => args[0]?.readyEl === '.missing'),
      'should log readyEl not found',
    );
  });

  test('a partial pageSession without selectPage does not replace direct navigation', async () => {
    _resetCollectorState();
    const mockResp = createMockResponse('http://fake/test', 200);
    const page = createMockPage({ responses: [mockResp] });

    let pageSessionUsed = false;
    const pageSession = {
      async goto(pg, url, opts) {
        pageSessionUsed = true;
        await pg.goto(url, opts);
      },
    };

    const response = await executeAttempt({
      page,
      meta: {
        name: 'test.pageSession',
        urlPattern: /test/,
        nav: { url: 'http://fake/test' },
      },
      params: {},
      ctx: {},
      log: { debug: () => {} },
      navUrl: 'http://fake/test',
      pageSession,
      prepareTransport: async () => {},
      cleanupTransport: async () => {},
      runTrigger: async () => {},
    });

    assert.ok(response);
    assert.equal(pageSessionUsed, false, 'partial pageSession compatibility is not a production contract');
  });

  test('a partial pageSession without recordNavigation does not select a sibling page', async () => {
    _resetCollectorState();
    const mockResp = createMockResponse('http://fake/test', 200);
    const page = createMockPage({ responses: [mockResp] });

    let selectCalled = false;
    const pageSession = {
      async selectPage() {
        selectCalled = true;
        return createMockPage({ responses: [mockResp] });
      },
    };

    const response = await executeAttempt({
      page,
      meta: {
        name: 'test.partialPageSession',
        urlPattern: /test/,
        nav: { url: 'http://fake/test' },
      },
      params: {},
      ctx: {},
      log: { debug: () => {} },
      navUrl: 'http://fake/test',
      pageSession,
      prepareTransport: async () => {},
      cleanupTransport: async () => {},
      runTrigger: async () => {},
    });

    assert.ok(response);
    assert.equal(selectCalled, false);
  });

  test('aborted signal causes immediate E_TIMEOUT rejection', async () => {
    _resetCollectorState();
    const page = createMockPage();
    const controller = new AbortController();
    controller.abort();

    let prepareCalled = false;

    await assert.rejects(
      () => executeAttempt({
        page,
        meta: {
          name: 'test.aborted',
          urlPattern: /test/,
          nav: { url: 'http://fake/test' },
        },
        params: {},
        ctx: { signal: controller.signal },
        log: { debug: () => {} },
        navUrl: 'http://fake/test',
        pageSession: null,
        prepareTransport: async () => { prepareCalled = true; },
        cleanupTransport: async () => {},
        runTrigger: async () => {},
      }),
      (err) => err.code === 'E_TIMEOUT',
    );

    assert.ok(!prepareCalled, 'prepareTransport should not be called when signal is aborted');
  });
});
