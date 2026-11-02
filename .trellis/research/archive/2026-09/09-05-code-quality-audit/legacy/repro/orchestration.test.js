import { beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';

const state = vi.hoisted(() => ({
  goods: [{ goods_id: '1', goods_name: 'synthetic item', quantity: 100 }],
  orders: [{ goods_id: '1', goods_name: 'synthetic item', quantity: 1 }],
  stale: vi.fn(), goodsScan: vi.fn(),
}));
const log = vi.hoisted(() => ({ debug() {}, info() {}, warn() {}, error() {} }));
vi.mock('../../../../src/commands/_runner.js', () => ({ withCommand: (spec) => spec.run }));
vi.mock('../../../../src/infra/logger.js', () => ({ getLogger: () => log }));
vi.mock('../../../../src/services/diagnose/goods-collector.js', () => ({ collectAllGoods: state.goodsScan }));
vi.mock('../../../../src/services/diagnose/orders-collector.js', () => ({
  collectOrdersForStaleAnalysis: state.stale, STALE_PAGE_SIZE: 50,
}));
vi.mock('../../../../src/services/orders.js', () => ({
  listOrders: async () => ({ orders: [] }), getOrderStats: async () => ({}),
  computeOrderStats: () => ({}),
}));
vi.mock('../../../../src/services/promo.js', () => ({
  getPromoReport: async () => ({ totals: {}, entities: [{ goodsId: '1', planId: 1, gmv: 100, spend: 10 }] }),
}));

const { run: actionPlan } = await import('../../../../src/commands/action/plan.js');
const { run: inventory } = await import('../../../../src/commands/diagnose/inventory.js');
const { run: goodsSegment } = await import('../../../../src/commands/goods/segment.js');
beforeEach(() => {
  state.stale.mockReset().mockResolvedValue({ orders: state.orders, truncated: false, ratelimited: false });
  state.goodsScan.mockReset().mockResolvedValue({ goods: state.goods, total: 1, truncated: false, ratelimited: false });
});

it('M1: action plan fetches the same 30-day order enrichment twice', async () => {
  await actionPlan({ page: {}, config: { promo: false, segment: true }, log });
  assert.equal(state.stale.mock.calls.length, 2);
});

it('F9: standalone inventory diagnosis drops cancellation and runtime context', async () => {
  const ctx = {
    page: {}, config: {}, log, mallCtx: { activeId: 'synthetic' },
    signal: new AbortController().signal, deadlineAt: 123, client: {}, pageSession: {},
  };
  await inventory(ctx);
  assert.deepEqual(state.goodsScan.mock.calls[0][1], { mallId: 'synthetic' });
  assert.equal(state.goodsScan.mock.calls[0][1].signal, undefined);
});

it('F6: goods segment reports full even though the goods scan was truncated', async () => {
  state.goodsScan.mockResolvedValue({ goods: state.goods, total: 100, truncated: true, ratelimited: false });
  const result = await goodsSegment({ page: {}, config: {}, log });
  assert.equal(result.data.summary.data_completeness, 'full');
  assert.deepEqual(result.warnings, []);
});
