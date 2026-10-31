import { it } from 'vitest';
import assert from 'node:assert/strict';
import { computeGoodsProfit } from '../../src/services/goods-profit-calculation.js';

const entry = (overrides = {}) => ({ goods_id: '101', spec: null, purchase_fen: 800,
  packaging_fen: 50, courier_fen: 300, insurance_fen: 30, technical_service_fen: 20,
  updated_at: '2026-10-01T00:00:00Z', ...overrides });
const order = (overrides = {}) => ({ goods_id: 101, goods_name: 'Tea', spec: 'red', goods_number: 2,
  order_amount: 2350, platform_discount: 50, merchant_discount: 100, shipping_amount: 200,
  after_sales_status: null, shipping_time: 1700000000, pay_status: 2, ...overrides });
const promo = (overrides = {}) => ({ complete: true, byGoods: new Map([['101', 100]]), total_fen: 150,
  attributed_fen: 100, shop_fen: 50, ...overrides });
const calculate = (overrides = {}) => computeGoodsProfit({ orders: [order()], entries: [entry()], promo: promo(),
  quality: { orders_complete: true }, ...overrides });

it('computes in fen, includes platform discount and does not double-deduct shipping or merchant discount', () => {
  const input = { orders: [order()], entries: [entry()], promo: promo(), quality: { orders_complete: true } };
  const before = structuredClone(input);
  const result = computeGoodsProfit(input);
  assert.deepEqual(input, before);
  assert.equal(result.items[0].revenue_fen, 2400);
  assert.equal(result.items[0].merchant_cost_fen, 2000);
  assert.equal(result.items[0].net_profit_fen, 300);
  assert.equal(result.summary.net_profit_fen, 250);
  assert.equal(result.items[0].default_fallback_order_count, 1);
});

it.each([0, '0'])('keeps all cancelled unpaid order amounts zero (%s)', (payStatus) => {
  const result = calculate({ orders: [order({ pay_status: payStatus, order_amount: null, platform_discount: null, goods_number: null })] });
  assert.equal(result.items[0].revenue_fen, 0);
  assert.equal(result.items[0].merchant_cost_fen, 0);
  assert.equal(result.items[0].gross_margin_pct, null);
});

it.each([5, '5'])('refunds revenue and goods while retaining shipped per-order costs (%s)', (status) => {
  const item = calculate({ orders: [order({ after_sales_status: status })] }).items[0];
  assert.equal(item.revenue_fen, 0);
  assert.equal(item.purchase_fen, 0);
  assert.equal(item.merchant_cost_fen, 400);
  assert.equal(item.refunded_order_count, 1);
});

it.each([0, '0', null, undefined, -1, 'invalid'])('handles refund shipping timestamp %s', (shippingTime) => {
  const item = calculate({ orders: [order({ after_sales_status: 5, shipping_time: shippingTime })] }).items[0];
  assert.equal(item.purchase_fen, 0);
  assert.equal(item.merchant_cost_fen, shippingTime === 0 || shippingTime === '0' ? 0 : null);
});

it.each([10, 11, '10', '11'])('includes open after-sales normally and reports their amount (%s)', (status) => {
  const item = calculate({ orders: [order({ after_sales_status: status })] }).items[0];
  assert.equal(item.after_sales_order_count, 1);
  assert.equal(item.after_sales_revenue_fen, 2400);
  assert.equal(item.net_profit_fen, 300);
});

it('matches exact specs then defaults and reports only the max timestamp actually used', () => {
  const entries = [entry(), entry({ spec: 'red', purchase_fen: 1000, updated_at: '2026-10-02T00:00:00Z' }),
    entry({ spec: 'unused', updated_at: '2026-10-03T00:00:00Z' })];
  const item = calculate({ entries, orders: [order(), order({ spec: 'red ' })] }).items[0];
  assert.equal(item.default_fallback_order_count, 1);
  assert.equal(item.purchase_fen, 3600);
  assert.equal(item.cost_updated_at, '2026-10-02T00:00:00Z');
});

it('propagates missing cost, required order fields, unknown sales status and missing promotion', () => {
  assert.equal(calculate({ entries: [] }).items[0].net_profit_fen, null);
  for (const overrides of [{ goods_number: null }, { platform_discount: null }, { after_sales_status: 99 }]) {
    assert.equal(calculate({ orders: [order(overrides)] }).items[0].net_profit_fen, null);
  }
  const missingStatus = order();
  delete missingStatus.after_sales_status;
  assert.equal(calculate({ orders: [missingStatus] }).items[0].refunded_order_count, null);
  assert.equal(calculate({ promo: promo({ complete: false }) }).summary.net_profit_fen, null);
  assert.equal(calculate({ promo: promo({ byGoods: new Map([['101', null]]) }) }).items[0].net_profit_fen, null);
  assert.equal(calculate({ promo: promo({ byGoods: new Map(), total_fen: 0, attributed_fen: 0, shop_fen: 0 }) }).items[0].promo_spend_fen, 0);
});

it('preserves observed income but nulls full-window finance when orders are incomplete', () => {
  const item = calculate({ quality: { orders_complete: false } }).items[0];
  assert.equal(item.order_count, null);
  assert.equal(item.observed_order_count, 1);
  assert.equal(item.revenue_fen, null);
  assert.equal(item.observed_revenue_fen, 2400);
  assert.equal(item.net_profit_fen, null);
});

it('keeps signed rates beyond 100 without clamping, and nulls zero denominators', () => {
  const item = calculate({ entries: [entry({ purchase_fen: 10000 })] }).items[0];
  assert.ok(item.gross_margin_pct < -100);
  assert.ok(item.net_margin_pct < -100);
  assert.equal(calculate({ orders: [] }).summary.net_margin_pct, null);
});

it('handles promo-only goods and missing identities without hiding unknown shop profit', () => {
  const onlyPromo = calculate({ orders: [], entries: [] });
  assert.equal(onlyPromo.items[0].net_profit_fen, null);
  const knownCost = calculate({ orders: [] });
  assert.equal(knownCost.items[0].net_profit_fen, -100);
  const unattributed = calculate({ orders: [order({ goods_id: null })] });
  assert.equal(unattributed.summary.unattributed_order_count, 1);
  assert.equal(unattributed.summary.net_profit_fen, null);
});
