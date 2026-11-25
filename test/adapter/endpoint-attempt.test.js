import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import { executeAttempt, navigatePageWithBudget } from '../../src/adapter/endpoint-attempt.js';
import { ExitCodes, PddCliError } from '../../src/infra/errors.js';
import { TIMEOUTS } from '../../src/infra/timeouts.js';

function createFakePage({ currentUrl = 'about:blank', gotoImpl, waitForSelectorImpl } = {}) {
  const listeners = new Map();
  let urlValue = currentUrl;
  const gotoCalls = [];
  const waitCalls = [];

  return {
    gotoCalls,
    waitCalls,
    url: () => urlValue,
    setUrl(nextUrl) {
      urlValue = nextUrl;
    },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler);
    },
    emit(event, payload) {
      for (const handler of [...(listeners.get(event) ?? [])]) {
        handler(payload);
      }
    },
    async goto(navUrl, options) {
      gotoCalls.push({ navUrl, options });
      if (gotoImpl) return gotoImpl(navUrl, options, (next) => { urlValue = next; });
      urlValue = navUrl;
    },
    async waitForSelector(selector, options) {
      waitCalls.push({ selector, options });
      if (waitForSelectorImpl) return waitForSelectorImpl(selector, options);
    },
  };
}

function createFakeResponse(url, body = { success: true, result: { ok: 1 } }, status = 200) {
  const req = { url };
  return {
    request: () => req,
    url: () => url,
    status: () => status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('navigatePageWithBudget', () => {
  it('returns false without navigating when navUrl is absent', async () => {
    const page = createFakePage();
    const navigated = await navigatePageWithBudget(page, undefined, { name: 'test.noNav' }, {});
    assert.equal(navigated, false);
    assert.equal(page.gotoCalls.length, 0);
  });

  it('clamps goto timeout to navTimeout and remaining command budget', async () => {
    const page = createFakePage();
    let nowMs = 10_000;
    const clock = { now: () => nowMs };

    await navigatePageWithBudget(page, 'https://mms.pinduoduo.com/a', { name: 'test.default' }, {});
    assert.deepEqual(page.gotoCalls[0].options, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUTS.QUICK_NAV,
    });

    await navigatePageWithBudget(
      page,
      'https://mms.pinduoduo.com/b',
      { name: 'test.custom', navTimeout: 5_000, nav: { waitUntil: 'load' } },
      { deadlineAt: nowMs + 12_000, clock },
    );
    assert.deepEqual(page.gotoCalls[1].options, { waitUntil: 'load', timeout: 5_000 });

    await navigatePageWithBudget(
      page,
      'https://mms.pinduoduo.com/c',
      { name: 'test.clamped', navTimeout: 15_000 },
      { deadlineAt: nowMs + 2_500, clock },
    );
    assert.deepEqual(page.gotoCalls[2].options, { waitUntil: 'domcontentloaded', timeout: 2_500 });
  });

  it('rejects before goto with E_TIMEOUT when aborted or deadline exhausted', async () => {
    const page = createFakePage();
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      navigatePageWithBudget(page, 'https://mms.pinduoduo.com/a', { name: 'test.abort' }, { signal: controller.signal }),
      { code: 'E_TIMEOUT', exitCode: ExitCodes.NETWORK },
    );
    await assert.rejects(
      navigatePageWithBudget(
        page,
        'https://mms.pinduoduo.com/a',
        { name: 'test.expired' },
        { deadlineAt: 1_000, clock: { now: () => 1_000 } },
      ),
      { code: 'E_TIMEOUT', exitCode: ExitCodes.NETWORK },
    );
    assert.equal(page.gotoCalls.length, 0);
  });

  it('propagates AbortSignal immediately while page.goto is in flight', async () => {
    const controller = new AbortController();
    const page = createFakePage({
      gotoImpl: () => new Promise(() => {}),
    });

    const pending = navigatePageWithBudget(
      page,
      'https://mms.pinduoduo.com/slow',
      { name: 'test.inflightAbort' },
      { signal: controller.signal },
    );
    controller.abort();

    await assert.rejects(pending, { code: 'E_TIMEOUT', exitCode: ExitCodes.NETWORK });
  });

  it('throws E_TIMEOUT when goto fails after deadline expiry and wraps other goto failures as E_NETWORK', async () => {
    let nowMs = 5_000;
    const clock = { now: () => nowMs };
    const deadlinePage = createFakePage({
      gotoImpl: async () => {
        nowMs = 6_000;
        throw new Error('Timeout 1000ms exceeded');
      },
    });
    await assert.rejects(
      navigatePageWithBudget(
        deadlinePage,
        'https://mms.pinduoduo.com/a',
        { name: 'test.deadlineDuringGoto' },
        { deadlineAt: 6_000, clock },
      ),
      { code: 'E_TIMEOUT', exitCode: ExitCodes.NETWORK },
    );

    const networkPage = createFakePage({
      gotoImpl: async () => { throw new Error('net::ERR_CONNECTION_RESET'); },
    });
    await assert.rejects(
      navigatePageWithBudget(
        networkPage,
        'https://mms.pinduoduo.com/fail',
        { name: 'test.netErr' },
        { deadlineAt: 10_000, clock: { now: () => 5_000 } },
      ),
      (err) => {
        assert.ok(err instanceof PddCliError);
        assert.equal(err.code, 'E_NETWORK');
        assert.equal(err.exitCode, ExitCodes.NETWORK);
        assert.match(err.message, /test\.netErr: navigation failed: net::ERR_CONNECTION_RESET/);
        assert.deepEqual(err.detail, { url: 'https://mms.pinduoduo.com/fail' });
        return true;
      },
    );
  });

  it('skips same-origin navigation only when skipIfSameOrigin is enabled', async () => {
    const page = createFakePage({ currentUrl: 'https://mms.pinduoduo.com/home' });
    const skipped = await navigatePageWithBudget(
      page,
      'https://mms.pinduoduo.com/orders',
      { name: 'test.sameOrigin' },
      {},
      { skipIfSameOrigin: true },
    );
    assert.equal(skipped, false);
    assert.equal(page.gotoCalls.length, 0);

    page.setUrl('https://other.example.com/landing');
    const navigated = await navigatePageWithBudget(
      page,
      'https://mms.pinduoduo.com/orders',
      { name: 'test.crossOrigin' },
      {},
      { skipIfSameOrigin: true },
    );
    assert.equal(navigated, true);
    assert.equal(page.gotoCalls.length, 1);
  });
});

describe('executeAttempt', () => {
  it('runs grouped transport hooks, pageSession selection, readyEl wait, trigger and cleanup on success', async () => {
    const primaryPage = createFakePage();
    const siblingPage = createFakePage();
    const calls = [];
    const pageSession = {
      selectPage: vi.fn(async () => siblingPage),
      recordNavigation: vi.fn((pg, url) => calls.push(['recordNavigation', pg === siblingPage, url])),
    };
    const matchedUrl = 'https://mms.pinduoduo.com/api/test';
    const response = createFakeResponse(matchedUrl);

    const meta = {
      name: 'test.attempt',
      urlPattern: /\/api\/test/,
      navTimeout: 8_000,
      collectorTimeout: 12_000,
      nav: { readyEl: '.ready-table' },
      trigger: async (pg) => {
        calls.push(['trigger', pg === siblingPage]);
        const req = response.request();
        pg.emit('request', req);
        pg.emit('response', response);
      },
    };

    const result = await executeAttempt({
      meta,
      params: { page: 1 },
      ctx: {
        page: primaryPage,
        navUrl: 'https://mms.pinduoduo.com/list',
        pageSession,
        deadlineAt: 10_000,
        clock: { now: () => 5_000 },
        log: { debug() {} },
      },
      transport: {
        prepare: async (pg) => calls.push(['prepare', pg === siblingPage]),
        cleanup: async (pg) => calls.push(['cleanup', pg === siblingPage]),
      },
    });

    assert.equal(result, response);
    assert.deepEqual(siblingPage.gotoCalls[0].options, { waitUntil: 'domcontentloaded', timeout: 5_000 });
    assert.equal(siblingPage.waitCalls[0].selector, '.ready-table');
    assert.equal(siblingPage.waitCalls[0].options.timeout, 5_000);
    assert.deepEqual(calls, [
      ['prepare', true],
      ['recordNavigation', true, 'https://mms.pinduoduo.com/list'],
      ['trigger', true],
      ['cleanup', true],
    ]);
  });

  it('always cleans up transport hooks on navigation failure and wraps requiredTrigger failures as E_GENERAL', async () => {
    const cleanup = vi.fn(async () => {});
    const failingNavPage = createFakePage({
      gotoImpl: async () => { throw new Error('boom'); },
    });

    await assert.rejects(
      executeAttempt({
        meta: { name: 'test.navFail', urlPattern: /api/ },
        ctx: { page: failingNavPage, navUrl: 'https://mms.pinduoduo.com/x', log: { debug() {} } },
        transport: { prepare: async () => {}, cleanup },
      }),
      { code: 'E_NETWORK', exitCode: ExitCodes.NETWORK },
    );
    assert.equal(cleanup.mock.calls.length, 1);

    const triggerFailPage = createFakePage();
    await assert.rejects(
      executeAttempt({
        meta: {
          name: 'test.reqTrigger',
          urlPattern: /api/,
          requiredTrigger: true,
          trigger: async () => { throw new Error('missing button'); },
        },
        ctx: { page: triggerFailPage, log: { debug() {} } },
        transport: { cleanup },
      }),
      { code: 'E_GENERAL', exitCode: ExitCodes.GENERAL },
    );
    assert.equal(cleanup.mock.calls.length, 2);
  });
});
