import { beforeEach, it } from 'vitest';
import assert from 'node:assert/strict';
import { collectProfitOrders, resolveProfitWindow } from '../../src/services/goods-profit.js';
import { createMemoryEndpointTransport, createTestCtx } from '../helpers/test-ctx.js';

const ordersRaw = (orders, total = orders.length) => ({
  success: true,
  result: { totalItemNum: total, pageItems: orders },
});

let transport;
let ctx;

beforeEach(() => {
  transport = createMemoryEndpointTransport();
  ctx = createTestCtx({ transport });
});

it('uses Shanghai complete days across year boundaries and enforces 1–90', () => {
  const window = resolveProfitWindow(2, Date.parse('2026-01-01T18:00:00Z') / 1000);
  assert.equal(window.startDate, '2025-12-31');
  assert.equal(window.endDate, '2026-01-01');
  assert.equal(window.end, Date.parse('2026-01-01T16:00:00Z') / 1000);
  for (const days of [0, 91, -1, 1.5, NaN]) assert.throws(() => resolveProfitWindow(days), { code: 'E_USAGE', exitCode: 2 });
  assert.equal(resolveProfitWindow(90).days, 90);
});

it('requests all orders by order time and filters by confirm_time with start inclusive and end exclusive', async () => {
  const window = resolveProfitWindow(30);
  const valid = { order_sn: 'SYN-1', goods_id: '101', confirm_time: window.start, order_time: 1, pay_status: 2 };
  transport.set('orders.list', ordersRaw([valid, { ...valid, order_sn: 'SYN-2', confirm_time: window.end },
    { ...valid, order_sn: 'SYN-3', confirm_time: window.start - 1 }], 3));
  const result = await collectProfitOrders(ctx.page, ctx, { window });
  assert.deepEqual(result.orders, [valid]);
  assert.equal(result.complete, true);
  assert.deepEqual(transport.calls.at(-1).params, { page: 1, size: 50, since: window.start, until: window.end - 1, scope: 'all' });
});

it('silently excludes unpaid cancelled orders whose confirm_time is 0', async () => {
  const window = resolveProfitWindow(30);
  const paid = { order_sn: 'SYN-1', goods_id: '101', confirm_time: window.start, pay_status: 2 };
  transport.set('orders.list', ordersRaw([paid, { order_sn: 'SYN-2', goods_id: '101', confirm_time: 0, pay_status: 0 }]));
  const result = await collectProfitOrders(ctx.page, ctx, { window });
  assert.deepEqual(result.orders, [paid]);
  assert.equal(result.complete, true);
  assert.deepEqual(result.hints, []);
});

it('marks a full capped page, rate limits and unusable confirm_time incomplete', async () => {
  const window = resolveProfitWindow(30);
  transport.set('orders.list', ordersRaw(Array.from({ length: 50 }, (unused, index) => ({
    order_sn: `SYN-${index}`, goods_id: '101', confirm_time: window.start,
  }))));
  assert.equal((await collectProfitOrders(ctx.page, ctx, { window, maxPages: 1 })).truncated, true);
  transport.set('orders.list', { success: false, errorCode: 54001, errorMsg: 'rate limited' });
  const limited = await collectProfitOrders(ctx.page, ctx, { window });
  assert.equal(limited.ratelimited, true);
  assert.equal(limited.complete, false);
  // 只有成团时间、成交时间非数字、已付款却为 0：都无法确定成交窗口
  for (const order of [{ group_time: window.start, pay_status: 2 }, { confirm_time: 'abc', pay_status: 2 },
    { confirm_time: 0, pay_status: 2 }, { confirm_time: 0 }]) {
    transport.set('orders.list', ordersRaw([{ order_sn: 'SYN-1', goods_id: '101', ...order }]));
    const result = await collectProfitOrders(ctx.page, ctx, { window });
    assert.equal(result.complete, false, JSON.stringify(order));
    assert.deepEqual(result.orders, []);
  }
});

it('deduplicates orders and flags conflicting duplicate facts', async () => {
  const window = resolveProfitWindow(30);
  const order = { order_sn: 'SYN-1', goods_id: '101', confirm_time: window.start, order_amount: 100 };
  transport.set('orders.list', ordersRaw([order, { ...order }, { ...order, order_amount: 200 }]));
  const result = await collectProfitOrders(ctx.page, ctx, { window });
  assert.equal(result.orders.length, 1);
  assert.equal(result.complete, false);
  transport.set('orders.list', ordersRaw([order, { ...order, confirm_time: window.start + 1 }]));
  assert.equal((await collectProfitOrders(ctx.page, ctx, { window })).complete, false);
});

it('propagates main-source network failures', async () => {
  transport.set('orders.list', { status: 500, raw: null });
  await assert.rejects(() => collectProfitOrders(ctx.page, ctx, { window: resolveProfitWindow(30) }), { code: 'E_NETWORK' });
});
