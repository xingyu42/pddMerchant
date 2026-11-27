import assert from 'node:assert/strict';
import { beforeEach, it, vi } from 'vitest';
import { collectOrdersInput } from '../../src/services/diagnose/collectors.js';
import { getShopDiagnosis } from '../../src/services/diagnose/reports.js';
import { getGoodsSegmentView } from '../../src/services/goods-segmentation.js';
import { createMemoryEndpointTransport, createTestCtx } from '../helpers/test-ctx.js';

let transport;
beforeEach(() => {
  transport = createMemoryEndpointTransport({
    responses: {
      'orders.stats': { success: true, result: { unship: 0, unship12h: 0, delay: 0, unreceive: 0 } },
      'orders.list': { success: true, result: { totalItemNum: 0, pageItems: [] } },
      'goods.list': { success: true, result: { total: 1, goods_list: [{ goods_id: '101', quantity: 1 }] } },
      'promo.entityReport': {
        success: true,
        result: { entityReportList: [], totalSumReport: { impression: 0, click: 0, gmv: 0, spend: 0 } },
      },
    },
  });
});

it.each([
  ['diagnose.shop', getShopDiagnosis, 3, { 'goods.list': 0, 'promo.entityReport': 1, 'orders.stats': 2 }],
  ['goods.segment', getGoodsSegmentView, 2, { 'orders.list': 0, 'promo.entityReport': 1 }],
  ['diagnose.shop.orders', (ctx) => collectOrdersInput(ctx.page, ctx), 1, { 'orders.stats': 0 }],
])('%s routes parallel sources to separate leased pages', async (_name, collect, count, routes) => {
  const pages = Array.from({ length: count }, () => ({ close: async () => {} }));
  const context = { newPage: vi.fn() };
  for (const leasedPage of pages) context.newPage.mockResolvedValueOnce(leasedPage);
  const page = { context: () => context };

  await collect(createTestCtx({ transport, page }));
  assert.equal(context.newPage.mock.calls.length, count);
  for (const [name, index] of Object.entries(routes)) {
    const calls = transport.calls.filter((call) => call.name === name);
    assert.ok(calls.length > 0, name);
    assert.ok(calls.every((call) => call.page === pages[index]), name);
  }
  const primaryEndpoint = _name === 'goods.segment' ? 'goods.list' : 'orders.list';
  assert.ok(transport.calls.some((call) => call.page === page && call.name === primaryEndpoint));
});
