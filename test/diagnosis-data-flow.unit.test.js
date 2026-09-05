import { beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';
const state = vi.hoisted(() => ({ goods: vi.fn(), orders: vi.fn(), stats: vi.fn(), promo: vi.fn() }));
const log = vi.hoisted(() => ({ debug() {}, info() {}, warn() {}, error() {} }));
vi.mock('../src/commands/_runner.js', () => ({ withCommand: (spec) => spec.run }));
vi.mock('../src/infra/logger.js', () => ({ getLogger: () => log }));
vi.mock('../src/services/diagnose/goods-collector.js', () => ({ collectAllGoods: state.goods }));
vi.mock('../src/services/diagnose/orders-collector.js', () => ({ collectOrdersForStaleAnalysis: state.orders, STALE_PAGE_SIZE: 50 }));
vi.mock('../src/services/orders.js', () => ({ listOrders: async () => ({ orders: [] }), getOrderStats: state.stats, computeOrderStats: () => ({}) }));
vi.mock('../src/services/promo.js', () => ({ getPromoReport: state.promo }));
const { run: plan } = await import('../src/commands/action/plan.js');
const { run: segment } = await import('../src/commands/goods/segment.js');
const { run: inventory } = await import('../src/commands/diagnose/inventory.js');
const { run: orders } = await import('../src/commands/diagnose/orders.js');
const { run: promo } = await import('../src/commands/diagnose/promo.js');
const { run: funnel } = await import('../src/commands/diagnose/funnel.js');
const goods = [{ goods_id: '1', goods_name: 'A', quantity: 100 }];
beforeEach(() => {
  state.goods.mockReset().mockResolvedValue({ goods, total: 1, truncated: false, ratelimited: false });
  state.orders.mockReset().mockResolvedValue({ orders: [{ goods_id: '1', goods_name: 'A', quantity: 1 }], truncated: false, ratelimited: false });
  state.stats.mockReset().mockResolvedValue({});
  state.promo.mockReset().mockResolvedValue({ totals: {}, entities: [{ goodsId: '1', planId: 1, spend: 10, gmv: 100 }] });
});
function context() {
  return { page: {}, config: {}, log, mallCtx: { activeId: 'test' }, signal: new AbortController().signal, deadlineAt: 123, client: {}, pageSession: {} };
}
it.each([[inventory, 'goods', 1], [orders, 'stats', 1], [promo, 'promo', 2], [funnel, 'orders', 1]])('standalone diagnosis preserves complete context (%#)', async (run, mock, arg) => {
  const ctx = context();
  await run(ctx);
  const forwarded = state[mock].mock.calls[0][arg];
  for (const key of ['signal', 'deadlineAt', 'client', 'pageSession', 'log']) assert.equal(forwarded[key], ctx[key]);
  assert.equal(forwarded.mallId, 'test');
});
it('goods truncation reaches inventory and segmentation outputs', async () => {
  state.goods.mockResolvedValue({ goods, total: 100, truncated: true, ratelimited: false });
  const inv = await inventory(context());
  assert.equal(inv.status, 'partial');
  assert.equal(inv.detail.data_quality.goods_complete, false);
  const seg = await segment(context());
  assert.equal(seg.data.summary.data_quality.goods_complete, false);
  assert.notEqual(seg.data.summary.data_completeness, 'full');
  const action = await plan(context());
  assert.equal(action.data.data_quality.inventory.goods_complete, false);
  assert.equal(action.data.data_quality.segmentation.goods_complete, false);
});
it('interrupted orders cannot become a final clearance recommendation', async () => {
  state.orders.mockResolvedValue({ orders: [], truncated: false, ratelimited: true });
  const result = await plan(context());
  assert.equal(result.data.actions.some((action) => action.action === 'clearance'), false);
  assert.equal(result.data.data_quality.segmentation.orders_complete, false);
  assert.ok(result.warnings.length > 0);
});
it('partial inventory sample does not become a store-wide score', async () => {
  const { diagnoseShop } = await import('../src/services/diagnose/index.js');
  const result = diagnoseShop({ goods: { goods, goodsTotal: 100, goodsScanTruncated: true, orders30d: [] } });
  assert.equal(result.status, 'partial');
  assert.equal(result.score, null);
  assert.equal(typeof result.dimensions.inventory.score, 'number');
});
