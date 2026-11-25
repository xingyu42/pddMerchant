import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';
import { PddCliError, ExitCodes } from '../../src/infra/errors.js';
import { collectBoundedPages } from '../../src/services/pagination.js';
import { collectOrdersWindow } from '../../src/services/orders.js';
import { collectAllGoods } from '../../src/services/diagnose/goods-collector.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('collectBoundedPages', () => {
  it('collects pages up to maxPages, delays between pages, and sets truncated when budget exhausted', async () => {
    vi.useFakeTimers();
    const pages = [
      Array.from({ length: 3 }, (_, index) => ({ id: index + 1 })),
      Array.from({ length: 3 }, (_, index) => ({ id: index + 4 })),
    ];
    const fetchPage = vi.fn(async (pageNum) => ({ items: pages[pageNum - 1] }));

    const pending = collectBoundedPages({
      fetchPage,
      readItems: (result) => result.items,
      pageSize: 3,
      maxPages: 2,
      delayMs: 200,
    });

    await vi.advanceTimersByTimeAsync(0);
    assert.equal(fetchPage.mock.calls.length, 1);
    await vi.advanceTimersByTimeAsync(199);
    assert.equal(fetchPage.mock.calls.length, 1);
    await vi.advanceTimersByTimeAsync(1);
    assert.equal(fetchPage.mock.calls.length, 2);

    const result = await pending;
    assert.equal(result.items.length, 6);
    assert.equal(result.total, null);
    assert.equal(result.truncated, true);
    assert.equal(result.ratelimited, false);
  });

  it('stops on short or empty page without sleeping or marking truncated', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: [1, 2, 3] })
      .mockResolvedValueOnce({ items: [4] });

    const result = await collectBoundedPages({
      fetchPage,
      readItems: (res) => res.items,
      pageSize: 3,
      maxPages: 5,
      delayMs: 0,
    });

    assert.deepEqual(result, { items: [1, 2, 3, 4], total: null, truncated: false, ratelimited: false });
    assert.equal(fetchPage.mock.calls.length, 2);

    const emptyFetch = vi.fn().mockResolvedValueOnce({ items: [] });
    const emptyResult = await collectBoundedPages({
      fetchPage: emptyFetch,
      readItems: (res) => res.items,
      pageSize: 3,
      maxPages: 5,
      delayMs: 0,
    });
    assert.deepEqual(emptyResult, { items: [], total: null, truncated: false, ratelimited: false });
  });

  it('respects reported total when readTotal is provided', async () => {
    const fullExact = vi.fn()
      .mockResolvedValueOnce({ items: [1, 2], total: 4 })
      .mockResolvedValueOnce({ items: [3, 4], total: 4 });
    const exact = await collectBoundedPages({
      fetchPage: fullExact,
      readItems: (res) => res.items,
      readTotal: (res) => res.total,
      pageSize: 2,
      maxPages: 2,
      delayMs: 0,
    });
    assert.deepEqual(exact, { items: [1, 2, 3, 4], total: 4, truncated: false, ratelimited: false });

    const fullMore = vi.fn()
      .mockResolvedValueOnce({ items: [1, 2], total: 5 })
      .mockResolvedValueOnce({ items: [3, 4], total: 5 });
    const more = await collectBoundedPages({
      fetchPage: fullMore,
      readItems: (res) => res.items,
      readTotal: (res) => res.total,
      pageSize: 2,
      maxPages: 2,
      delayMs: 0,
    });
    assert.deepEqual(more, { items: [1, 2, 3, 4], total: 5, truncated: true, ratelimited: false });
  });

  it('ignores non-positive or non-finite reported totals', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ items: [1, 2], total: 0 });
    const result = await collectBoundedPages({
      fetchPage,
      readItems: (res) => res.items,
      readTotal: (res) => res.total,
      pageSize: 2,
      maxPages: 1,
      delayMs: 0,
    });
    assert.deepEqual(result, { items: [1, 2], total: null, truncated: true, ratelimited: false });
  });

  it('stops cleanly on E_RATE_LIMIT while propagating other errors', async () => {
    const rateErr = new PddCliError({ code: 'E_RATE_LIMIT', message: '429', exitCode: ExitCodes.RATE_LIMIT });
    const fetchRateLimited = vi.fn()
      .mockResolvedValueOnce({ items: [1, 2] })
      .mockRejectedValueOnce(rateErr);
    const limited = await collectBoundedPages({
      fetchPage: fetchRateLimited,
      readItems: (res) => res.items,
      pageSize: 2,
      maxPages: 5,
      delayMs: 0,
    });
    assert.deepEqual(limited, { items: [1, 2], total: null, truncated: false, ratelimited: true });

    const netErr = new PddCliError({ code: 'E_NETWORK', message: 'down', exitCode: ExitCodes.NETWORK });
    await assert.rejects(() => collectBoundedPages({
      fetchPage: vi.fn().mockRejectedValueOnce(netErr),
      readItems: (res) => res.items,
      pageSize: 2,
      maxPages: 5,
      delayMs: 0,
    }), { code: 'E_NETWORK' });
  });

  it('aborts immediately before fetching, during fetch, or during inter-page sleep', async () => {
    const preAborted = new AbortController();
    preAborted.abort();
    const neverCalled = vi.fn();
    await assert.rejects(() => collectBoundedPages({
      fetchPage: neverCalled,
      readItems: (res) => res.items,
      signal: preAborted.signal,
    }), { code: 'E_TIMEOUT' });
    assert.equal(neverCalled.mock.calls.length, 0);

    vi.useFakeTimers();
    const sleepController = new AbortController();
    const fetchTwo = vi.fn().mockResolvedValue({ items: [1, 2] });
    const sleepPending = collectBoundedPages({
      fetchPage: fetchTwo,
      readItems: (res) => res.items,
      pageSize: 2,
      maxPages: 3,
      delayMs: 200,
      signal: sleepController.signal,
    });
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(fetchTwo.mock.calls.length, 1);
    sleepController.abort();
    await assert.rejects(() => sleepPending, { code: 'E_TIMEOUT' });
    assert.equal(fetchTwo.mock.calls.length, 1);
  });

  it('isolates concurrent traversals with independent AbortSignals', async () => {
    vi.useFakeTimers();
    const firstCtrl = new AbortController();
    const secondCtrl = new AbortController();
    const firstFetch = vi.fn().mockResolvedValue({ items: [1, 2] });
    const secondFetch = vi.fn()
      .mockResolvedValueOnce({ items: [10, 20] })
      .mockResolvedValueOnce({ items: [30] });

    const first = collectBoundedPages({
      fetchPage: firstFetch,
      readItems: (res) => res.items,
      pageSize: 2,
      maxPages: 3,
      delayMs: 200,
      signal: firstCtrl.signal,
    });
    const second = collectBoundedPages({
      fetchPage: secondFetch,
      readItems: (res) => res.items,
      pageSize: 2,
      maxPages: 3,
      delayMs: 200,
      signal: secondCtrl.signal,
    });

    await vi.advanceTimersByTimeAsync(0);
    firstCtrl.abort();
    await assert.rejects(() => first, { code: 'E_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(200);
    const secondResult = await second;
    assert.deepEqual(secondResult, { items: [10, 20, 30], total: null, truncated: false, ratelimited: false });
  });
});

describe('collectOrdersWindow and collectAllGoods parity', () => {
  it('collectOrdersWindow ignores page total and aborts on ctx.signal during sleep', async () => {
    vi.useFakeTimers();
    const fullPage = Array.from({ length: 50 }, (_, index) => ({ order_sn: `O-${index}` }));
    const listOrders = vi.fn(async () => ({ orders: fullPage, total: 50 }));
    const controller = new AbortController();

    const pending = collectOrdersWindow({}, { signal: controller.signal }, {
      listOrders,
      now: 1700000000,
      maxPages: 3,
    });
    await vi.advanceTimersByTimeAsync(0);
    assert.deepEqual(listOrders.mock.calls[0][1], {
      page: 1,
      size: 50,
      since: 1700000000 - 30 * 86400,
      until: 1700000000,
      scope: 'valid',
    });
    controller.abort();
    await assert.rejects(() => pending, { code: 'E_TIMEOUT' });
  });

  it('collectAllGoods respects total and aborts on ctx.signal during sleep', async () => {
    vi.useFakeTimers();
    const listGoods = vi.fn(async () => ({
      goods: Array.from({ length: 2 }, (_, index) => ({ goods_id: String(index + 1) })),
      total: 4,
    }));

    const exactPending = collectAllGoods({}, {}, { listGoods, pageSize: 2, maxPages: 2 });
    await vi.advanceTimersByTimeAsync(200);
    const exact = await exactPending;
    assert.equal(exact.goods.length, 4);
    assert.equal(exact.total, 4);
    assert.equal(exact.truncated, false);

    const controller = new AbortController();
    const abortPending = collectAllGoods({}, { signal: controller.signal }, {
      listGoods: vi.fn(async () => ({ goods: [{ goods_id: '1' }, { goods_id: '2' }], total: 10 })),
      pageSize: 2,
      maxPages: 5,
    });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assert.rejects(() => abortPending, { code: 'E_TIMEOUT' });
  });
});
