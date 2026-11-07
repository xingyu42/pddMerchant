import assert from 'node:assert/strict';
import { beforeEach, it, vi } from 'vitest';
import { runEndpoint } from '../../src/adapter/run-endpoint.js';
import { collectOrdersInput } from '../../src/services/diagnose/collectors.js';
import { getShopDiagnosis } from '../../src/services/diagnose/reports.js';
import { getGoodsSegmentView } from '../../src/services/goods-segmentation.js';

vi.mock('../../src/adapter/run-endpoint.js', () => ({ runEndpoint: vi.fn() }));
beforeEach(() => {
  runEndpoint.mockReset().mockImplementation(async (_page, spec) => {
    if (spec.name === 'orders.stats') return { unship: 0, delay: 0 };
    if (spec.name === 'orders.list') return { orders: [], total: 0 };
    if (spec.name === 'goods.list') return { goods: [{ goods_id: '101', quantity: 1 }], total: 1 };
    if (spec.name === 'promo.entityReport') return { entities: [], totals: {} };
    throw new Error(`unexpected endpoint ${spec.name}`);
  });
});

it.each([
  ['diagnose.shop', getShopDiagnosis, 3, { 'goods.list': 0, 'promo.entityReport': 1, 'orders.stats': 2 }],
  ['goods.segment', getGoodsSegmentView, 2, { 'orders.list': 0, 'promo.entityReport': 1 }],
  ['diagnose.orders', (ctx) => collectOrdersInput(ctx.page, ctx), 1, { 'orders.stats': 0 }],
])('%s routes parallel sources to separate leased pages', async (_name, collect, count, routes) => {
  const pages = Array.from({ length: count }, () => ({ close: async () => {} }));
  const context = { newPage: vi.fn() };
  for (const leasedPage of pages) context.newPage.mockResolvedValueOnce(leasedPage);
  const page = { context: () => context };

  await collect({ page, log: { debug() {} } });
  assert.equal(context.newPage.mock.calls.length, count);
  for (const [name, index] of Object.entries(routes)) {
    const calls = runEndpoint.mock.calls.filter(([, spec]) => spec.name === name);
    assert.ok(calls.length > 0, name);
    assert.ok(calls.every(([usedPage]) => usedPage === pages[index]), name);
  }
  const primaryEndpoint = _name === 'goods.segment' ? 'goods.list' : 'orders.list';
  assert.ok(runEndpoint.mock.calls.some(([usedPage, spec]) => usedPage === page && spec.name === primaryEndpoint));
});
