import { test } from 'vitest';
import assert from 'node:assert/strict';
import { collectOrdersForStaleAnalysis } from '../src/services/diagnose/orders-collector.js';
import { PddCliError, ExitCodes } from '../src/infra/errors.js';

function makePager(pages) {
  let cursor = 0;
  return async () => {
    const next = pages[cursor];
    cursor += 1;
    if (!next) return { total: 0, orders: [], raw: { mock: true } };
    return next;
  };
}

test('collectOrdersForStaleAnalysis: single short page → break, no truncation', async () => {
  const pager = makePager([
    { total: 3, orders: [{ goods_name: 'A' }, { goods_name: 'B' }, { goods_name: 'C' }], raw: {} },
  ]);
  const r = await collectOrdersForStaleAnalysis(null, {}, { delayMs: 0, listOrders: pager });
  assert.equal(r.orders.length, 3);
  assert.equal(r.truncated, false);
  assert.equal(r.ratelimited, false);
});

test('collectOrdersForStaleAnalysis: page-size full at maxPages → truncated=true', async () => {
  const fullPage = {
    total: 999,
    orders: Array.from({ length: 50 }, (_, i) => ({ goods_name: `G${i}` })),
    raw: {},
  };
  const pager = makePager(Array.from({ length: 10 }, () => fullPage));
  const r = await collectOrdersForStaleAnalysis(null, {}, { delayMs: 0, listOrders: pager });
  assert.equal(r.orders.length, 500);
  assert.equal(r.truncated, true);
  assert.equal(r.ratelimited, false);
});

test('collectOrdersForStaleAnalysis: E_RATE_LIMIT mid-flight → ratelimited=true, partial orders kept', async () => {
  let calls = 0;
  const pager = async () => {
    calls += 1;
    if (calls === 1) {
      return { total: 100, orders: Array.from({ length: 50 }, () => ({ goods_name: 'A' })), raw: {} };
    }
    throw new PddCliError({ code: 'E_RATE_LIMIT', message: 'rate limited', exitCode: ExitCodes.RATE_LIMIT });
  };
  const r = await collectOrdersForStaleAnalysis(null, {}, { delayMs: 0, listOrders: pager });
  assert.equal(r.orders.length, 50);
  assert.equal(r.ratelimited, true);
  assert.equal(r.truncated, false);
});

test('collectOrdersForStaleAnalysis: short last page within max → no truncation', async () => {
  const pager = makePager([
    { total: 75, orders: Array.from({ length: 50 }, () => ({ goods_name: 'A' })), raw: {} },
    { total: 75, orders: Array.from({ length: 25 }, () => ({ goods_name: 'B' })), raw: {} },
  ]);
  const r = await collectOrdersForStaleAnalysis(null, {}, { delayMs: 0, listOrders: pager });
  assert.equal(r.orders.length, 75);
  assert.equal(r.truncated, false);
  assert.equal(r.ratelimited, false);
});

test('collectOrdersForStaleAnalysis: non-rate-limit error rethrown', async () => {
  const pager = async () => {
    throw new PddCliError({ code: 'E_NETWORK', message: 'boom', exitCode: ExitCodes.NETWORK });
  };
  await assert.rejects(
    () => collectOrdersForStaleAnalysis(null, {}, { delayMs: 0, listOrders: pager }),
    (err) => err instanceof PddCliError && err.code === 'E_NETWORK',
  );
});

test('collectOrdersForStaleAnalysis: passes since/until window to listOrders', async () => {
  const captured = [];
  const pager = async (_page, params) => {
    captured.push(params);
    return { total: 1, orders: [{ goods_name: 'A' }], raw: {} };
  };
  const fixedNow = 1_700_000_000;
  await collectOrdersForStaleAnalysis(null, {}, { delayMs: 0, listOrders: pager, now: fixedNow });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].since, fixedNow - 30 * 86400);
  assert.equal(captured[0].until, fixedNow);
  assert.equal(captured[0].page, 1);
  assert.equal(captured[0].size, 50);
});
