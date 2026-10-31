import { it } from 'vitest';
import assert from 'node:assert/strict';
import { computeGoodsProfit } from '../../src/services/goods-profit-calculation.js';
import { resolveProfitWindow } from '../../src/services/goods-profit.js';
import { toGoodsProfitView, GOODS_PROFIT_ITEM_FIELDS, GOODS_PROFIT_SUMMARY_FIELDS, GOODS_PROFIT_QUALITY_FIELDS } from '../../src/services/views/goods-profit.js';
import { assertDataContractV2 } from '../helpers/data-contract.js';

it('projects only exact profit facts in yuan with signed rates and fixed disclosures', () => {
  const quality = { orders_complete: true, orders_truncated: false, orders_ratelimited: false,
    promo_complete: true, promo_truncated: false, promo_ratelimited: false };
  const analysis = computeGoodsProfit({ orders: [{ goods_id: '101', goods_number: 1, order_amount: 100,
    platform_discount: 0, after_sales_status: null, buyer_memo: 'SYN-SECRET' }],
  entries: [{ goods_id: '101', spec: null, purchase_fen: 400, packaging_fen: 0, courier_fen: 0,
    insurance_fen: 0, technical_service_fen: 0, updated_at: '2026-10-01T00:00:00Z' }],
  promo: { complete: true, byGoods: new Map(), total_fen: 0, attributed_fen: 0, shop_fen: 0 }, quality });
  const data = toGoodsProfitView(analysis, { window: resolveProfitWindow(30), quality, mallId: '900001' });
  assertDataContractV2(data, { entityFields: { 'items[]': GOODS_PROFIT_ITEM_FIELDS,
    summary: GOODS_PROFIT_SUMMARY_FIELDS, 'summary.data_quality': GOODS_PROFIT_QUALITY_FIELDS } });
  assert.equal(data.items[0].net_profit_yuan, -3);
  assert.equal(data.items[0].net_margin_pct, -300);
  assert.equal(data.items[0].cost_updated_at, '2026-10-01 08:00:00');
  assert.ok(data.hints.some((hint) => hint.includes('仅退款不退货')));
  assert.ok(data.hints.some((hint) => hint.includes('共担')));
  assert.ok(data.hints.some((hint) => hint.includes('仅含商品推广报表口径')));
  assert.equal(JSON.stringify(data).includes('SYN-SECRET'), false);
});
