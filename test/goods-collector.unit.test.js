import { test } from 'vitest';
import assert from 'node:assert/strict';
import { collectAllGoods } from '../src/services/diagnose/goods-collector.js';
import { PddCliError, ExitCodes } from '../src/infra/errors.js';

function makePager(pages) {
  let cursor = 0;
  return async () => {
    const next = pages[cursor];
    cursor += 1;
    if (!next) return { total: 0, goods: [], raw: { mock: true } };
    return next;
  };
}

function rangeGoods(start, count, prefix = 'G') {
  return Array.from({ length: count }, (_, i) => ({
    goods_id: String(start + i),
    goods_name: `${prefix}${start + i}`,
    quantity: 10,
  }));
}

test('collectAllGoods: single short page stops cleanly, no truncation', async () => {
  const pager = makePager([
    { total: 3, goods: rangeGoods(1, 3), raw: {} },
  ]);
  const r = await collectAllGoods(null, {}, { delayMs: 0, listGoods: pager });
  assert.equal(r.goods.length, 3);
  assert.equal(r.total, 3);
  assert.equal(r.truncated, false);
  assert.equal(r.ratelimited, false);
});

test('collectAllGoods: reported total reached across multiple pages → clean stop, no truncation', async () => {
  const pager = makePager([
    { total: 75, goods: rangeGoods(1, 50), raw: {} },
    { total: 75, goods: rangeGoods(51, 25), raw: {} },
  ]);
  const r = await collectAllGoods(null, {}, { delayMs: 0, listGoods: pager });
  assert.equal(r.goods.length, 75);
  assert.equal(r.total, 75);
  assert.equal(r.truncated, false);
});

test('collectAllGoods: full pages through maxPages with total > cap → truncated=true', async () => {
  const fullPage = { total: 9999, goods: rangeGoods(1, 50), raw: {} };
  const pager = makePager(Array.from({ length: 10 }, () => fullPage));
  const r = await collectAllGoods(null, {}, { delayMs: 0, listGoods: pager });
  assert.equal(r.goods.length, 500);
  assert.equal(r.total, 9999);
  assert.equal(r.truncated, true);
  assert.equal(r.ratelimited, false);
});

test('collectAllGoods: final page full but total exactly 500 → NOT truncated', async () => {
  const fullPage = { total: 500, goods: rangeGoods(1, 50), raw: {} };
  const pager = makePager(Array.from({ length: 10 }, () => fullPage));
  const r = await collectAllGoods(null, {}, { delayMs: 0, listGoods: pager });
  assert.equal(r.goods.length, 500);
  assert.equal(r.total, 500);
  assert.equal(r.truncated, false, 'goods.length >= total should stop cleanly');
});

test('collectAllGoods: empty page → break without truncation', async () => {
  const pager = makePager([
    { total: 50, goods: rangeGoods(1, 50), raw: {} },
    { total: 50, goods: [], raw: {} },
  ]);
  const r = await collectAllGoods(null, {}, { delayMs: 0, listGoods: pager });
  assert.equal(r.goods.length, 50);
  assert.equal(r.truncated, false);
});

test('collectAllGoods: E_RATE_LIMIT mid-flight → ratelimited=true, partial goods kept', async () => {
  let calls = 0;
  const pager = async () => {
    calls += 1;
    if (calls === 1) {
      return { total: 200, goods: rangeGoods(1, 50), raw: {} };
    }
    throw new PddCliError({ code: 'E_RATE_LIMIT', message: 'rate limited', exitCode: ExitCodes.RATE_LIMIT });
  };
  const r = await collectAllGoods(null, {}, { delayMs: 0, listGoods: pager });
  assert.equal(r.goods.length, 50);
  assert.equal(r.ratelimited, true);
  assert.equal(r.truncated, false);
});

test('collectAllGoods: non-rate-limit error is rethrown', async () => {
  const pager = async () => {
    throw new PddCliError({ code: 'E_NETWORK', message: 'boom', exitCode: ExitCodes.NETWORK });
  };
  await assert.rejects(
    () => collectAllGoods(null, {}, { delayMs: 0, listGoods: pager }),
    (err) => err instanceof PddCliError && err.code === 'E_NETWORK',
  );
});

test('collectAllGoods: passes page/size params to listGoods', async () => {
  const captured = [];
  const pager = async (_page, params) => {
    captured.push(params);
    // Each page returns 1 goods so it'll keep going; break after 3 pages via partial
    return { total: 3, goods: rangeGoods(captured.length, 1), raw: {} };
  };
  await collectAllGoods(null, {}, { delayMs: 0, listGoods: pager });
  assert.equal(captured.length, 1, 'first page returns <pageSize so loop stops after one call');
  assert.equal(captured[0].page, 1);
  assert.equal(captured[0].size, 50);
});

test('collectAllGoods: total=null (API did not report) uses empty-page / cap termination', async () => {
  const fullPage = { goods: rangeGoods(1, 50), raw: {} }; // NO total field
  const pager = makePager(Array.from({ length: 10 }, () => fullPage));
  const r = await collectAllGoods(null, {}, { delayMs: 0, listGoods: pager });
  assert.equal(r.goods.length, 500);
  assert.equal(r.total, null);
  assert.equal(r.truncated, true, 'unknown total + full pages at cap → treat as truncated');
});

test('collectAllGoods: passes ctx through to listGoods', async () => {
  const capturedCtx = [];
  const pager = async (_page, _params, ctx) => {
    capturedCtx.push(ctx);
    return { total: 1, goods: rangeGoods(1, 1), raw: {} };
  };
  const ctx = { mallId: '445301049' };
  await collectAllGoods(null, ctx, { delayMs: 0, listGoods: pager });
  assert.equal(capturedCtx[0].mallId, '445301049');
});
