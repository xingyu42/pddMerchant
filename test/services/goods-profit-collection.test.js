import { it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { runEndpoint } from '../../src/adapter/run-endpoint.js';
import { PddCliError } from '../../src/infra/errors.js';
import { collectProfitOrders, resolveProfitWindow } from '../../src/services/goods-profit.js';

vi.mock('../../src/adapter/run-endpoint.js', async (original) => ({ ...(await original()), runEndpoint: vi.fn() }));

it('uses Shanghai complete days across year boundaries and enforces 1–90', () => {
  const window = resolveProfitWindow(2, Date.parse('2026-01-01T18:00:00Z') / 1000);
  assert.equal(window.startDate, '2025-12-31');
  assert.equal(window.endDate, '2026-01-01');
  assert.equal(window.end, Date.parse('2026-01-01T16:00:00Z') / 1000);
  for (const days of [0, 91, -1, 1.5, NaN]) assert.throws(() => resolveProfitWindow(days), { code: 'E_USAGE', exitCode: 2 });
  assert.equal(resolveProfitWindow(90).days, 90);
});

it('requests all orders with group-time boundaries and filters by group_time only', async () => {
  const window = resolveProfitWindow(30);
  const valid = { order_sn: 'SYN-1', goods_id: '101', group_time: window.start, order_time: 1 };
  runEndpoint.mockResolvedValue({ total: 3, orders: [valid, { ...valid, order_sn: 'SYN-2', group_time: window.end },
    { ...valid, order_sn: 'SYN-3', group_time: window.start - 1 }] });
  const result = await collectProfitOrders(null, {}, { window });
  assert.deepEqual(result.orders, [valid]);
  assert.equal(result.complete, true);
  assert.deepEqual(runEndpoint.mock.calls.at(-1)[2], { page: 1, size: 50, since: window.start, until: window.end - 1, scope: 'all' });
});

it('marks a full capped page, rate limits and missing group_time incomplete', async () => {
  const window = resolveProfitWindow(30);
  runEndpoint.mockResolvedValue({ orders: Array.from({ length: 50 }, (unused, index) => ({ order_sn: `SYN-${index}`, goods_id: '101', group_time: window.start })) });
  assert.equal((await collectProfitOrders(null, {}, { window, maxPages: 1 })).truncated, true);
  runEndpoint.mockRejectedValue(new PddCliError({ code: 'E_RATE_LIMIT', exitCode: 4 }));
  const limited = await collectProfitOrders(null, {}, { window });
  assert.equal(limited.ratelimited, true);
  assert.equal(limited.complete, false);
  runEndpoint.mockResolvedValue({ orders: [{ goods_id: '101', group_time: null }] });
  assert.equal((await collectProfitOrders(null, {}, { window })).complete, false);
});

it('deduplicates orders and flags conflicting duplicate facts', async () => {
  const window = resolveProfitWindow(30);
  const order = { order_sn: 'SYN-1', goods_id: '101', group_time: window.start, order_amount: 100 };
  runEndpoint.mockResolvedValue({ orders: [order, { ...order }, { ...order, order_amount: 200 }] });
  const result = await collectProfitOrders(null, {}, { window });
  assert.equal(result.orders.length, 1);
  assert.equal(result.complete, false);
});

it('propagates main-source network failures', async () => {
  runEndpoint.mockRejectedValue(new PddCliError({ code: 'E_NETWORK', exitCode: 5 }));
  await assert.rejects(() => collectProfitOrders(null, {}, { window: resolveProfitWindow(30) }), { code: 'E_NETWORK' });
});
