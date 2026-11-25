import { beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { getGoodsProfitView } from '../../src/services/goods-profit.js';
import { run } from '../../src/infra/db.js';
import { insertAccount } from '../../src/infra/account-store.js';
import { upsertGoodsCosts } from '../../src/infra/goods-cost-store.js';
import { createRateLimiter } from '../../src/adapter/rate-limiter.js';
import { createMemoryEndpointTransport, createTestCtx } from '../helpers/test-ctx.js';

const NOW_MS = Date.parse('2026-11-15T02:00:00Z');
const IN_WINDOW = Date.parse('2026-11-10T00:00:00Z') / 1000;

let activeAccount;
beforeEach(() => {
  vi.useFakeTimers({ now: NOW_MS });
  activeAccount = insertAccount({ kind: 'merchant', identity: '900001', displayName: 'Synthetic Shop' }, { setDefault: true });
});

const entry = (overrides = {}) => ({
  goods_id: '101', spec: null, purchase_fen: 800,
  packaging_fen: 50, courier_fen: 300, technical_service_fen: 20, ...overrides,
});
const order = (overrides = {}) => ({
  order_sn: 'SYN-1', goods_id: 101, goods_name: 'Tea', spec: 'red', goods_number: 2,
  order_amount: 2350, platform_discount: 50, merchant_discount: 100, shipping_amount: 200,
  after_sales_status: null, shipping_time: 1700000000, pay_status: 2, confirm_time: IN_WINDOW, ...overrides,
});
const promoRaw = (entities = [{ goodsId: '101', impression: 10, click: 1, gmv: 24, spend: 1 }], spend = 1.5) => ({
  success: true,
  result: { entityReportList: entities, totalSumReport: { impression: 10, click: 1, gmv: 24, spend } },
});
const fee = (orderSn, value, feeStatusDesc = '收费成功') => ({
  orderSn, serviceAmountVO: { unit: 'YUAN', value }, feeStatusDesc,
});
const insuranceRaw = (orderInsurances = [fee('SYN-1', '0.30')], total = orderInsurances.length) => ({
  success: true, errorCode: 0, result: { total, orderInsurances },
});

async function calculate({
  orders = [order()],
  entries = [entry()],
  promo = promoRaw(),
  insurance = insuranceRaw(),
  days = 29,
  setupCosts = null,
} = {}) {
  run('DELETE FROM goods_cost_entries');
  if (setupCosts) {
    setupCosts(activeAccount.id);
  } else if (entries.length > 0) {
    upsertGoodsCosts({ accountId: activeAccount.id, mallId: '900001', entries });
  }
  const transport = createMemoryEndpointTransport({
    responses: {
      'orders.list': { success: true, result: { totalItemNum: orders.length, pageItems: orders } },
      'promo.entityReport': promo,
      'experiencePlan.orderInsuranceList': insurance,
    },
  });
  const ctx = createTestCtx({
    transport,
    accountId: activeAccount.id,
    account: activeAccount,
    mallId: '900001',
    limiter: createRateLimiter({ qps: 0 }),
  });
  const pending = getGoodsProfitView(ctx, { days });
  await vi.runAllTimersAsync();
  return pending;
}

it('computes in yuan, includes platform discount and does not double-deduct shipping or merchant discount', async () => {
  const { data } = await calculate();
  assert.equal(data.items[0].revenue_yuan, 24);
  assert.equal(data.items[0].merchant_cost_yuan, 20);
  assert.equal(data.items[0].net_profit_yuan, 3);
  assert.equal(data.summary.net_profit_yuan, 2.5);
  assert.equal(data.items[0].default_fallback_order_count, 1);
});

it.each([0, '0'])('keeps all cancelled unpaid order amounts zero (%s)', async (payStatus) => {
  const { data } = await calculate({
    orders: [order({ pay_status: payStatus, order_amount: null, platform_discount: null, goods_number: null })],
  });
  assert.equal(data.items[0].revenue_yuan, 0);
  assert.equal(data.items[0].merchant_cost_yuan, 0);
  assert.equal(data.items[0].gross_margin_pct, null);
});

it.each([5, '5'])('refunds revenue and goods while retaining shipped per-order costs (%s)', async (status) => {
  const { data } = await calculate({ orders: [order({ after_sales_status: status })] });
  const item = data.items[0];
  assert.equal(item.revenue_yuan, 0);
  assert.equal(item.purchase_yuan, 0);
  assert.equal(item.merchant_cost_yuan, 4);
  assert.equal(item.refunded_order_count, 1);
});

it.each([0, '0', null, undefined, -1, 'invalid'])('handles refund shipping timestamp %s', async (shippingTime) => {
  const { data } = await calculate({
    orders: [order({ after_sales_status: 5, shipping_time: shippingTime })],
    insurance: insuranceRaw([]),
  });
  const item = data.items[0];
  assert.equal(item.purchase_yuan, 0);
  assert.equal(item.merchant_cost_yuan, shippingTime === 0 || shippingTime === '0' ? 0 : null);
});

it.each([10, 11, '10', '11'])('includes open after-sales normally and reports their amount (%s)', async (status) => {
  const { data } = await calculate({ orders: [order({ after_sales_status: status })] });
  const item = data.items[0];
  assert.equal(item.after_sales_order_count, 1);
  assert.equal(item.after_sales_revenue_yuan, 24);
  assert.equal(item.net_profit_yuan, 3);
});

it('matches exact specs then defaults and reports only the max timestamp actually used', async () => {
  const { data } = await calculate({
    orders: [order(), order({ order_sn: 'SYN-2', spec: 'red ' })],
    insurance: insuranceRaw([fee('SYN-1', '0.30'), fee('SYN-2', '0.30')]),
    setupCosts(accountId) {
      vi.setSystemTime(Date.parse('2026-10-01T00:00:00Z'));
      upsertGoodsCosts({ accountId, mallId: '900001', entries: [entry()] });
      vi.setSystemTime(Date.parse('2026-10-02T00:00:00Z'));
      upsertGoodsCosts({ accountId, mallId: '900001', entries: [entry({ spec: 'red', purchase_fen: 1000 })] });
      vi.setSystemTime(Date.parse('2026-10-03T00:00:00Z'));
      upsertGoodsCosts({ accountId, mallId: '900001', entries: [entry({ spec: 'unused' })] });
      vi.setSystemTime(NOW_MS);
    },
  });
  const item = data.items[0];
  assert.equal(item.default_fallback_order_count, 1);
  assert.equal(item.purchase_yuan, 36);
  assert.equal(item.cost_updated_at, '2026-10-02 08:00:00');
});

it('propagates missing cost, required order fields, unknown sales status and missing promotion', async () => {
  assert.equal((await calculate({ entries: [] })).data.items[0].net_profit_yuan, null);
  for (const overrides of [{ goods_number: null }, { platform_discount: null }, { after_sales_status: 'x' }]) {
    assert.equal((await calculate({ orders: [order(overrides)] })).data.items[0].net_profit_yuan, null);
  }
  const missingStatus = order();
  delete missingStatus.after_sales_status;
  assert.equal((await calculate({ orders: [missingStatus] })).data.items[0].refunded_order_count, null);
  assert.equal((await calculate({ promo: { status: 500, raw: null } })).data.summary.net_profit_yuan, null);
  assert.equal((await calculate({
    promo: promoRaw([{ goodsId: '101', impression: 1, click: 1, gmv: 1, spend: { value: 1, unit: 'UNKNOWN' } }], 1),
  })).data.items[0].net_profit_yuan, null);
  assert.equal((await calculate({ promo: promoRaw([], 0) })).data.items[0].promo_spend_yuan, 0);
});

it('preserves observed income but nulls full-window finance when orders are incomplete', async () => {
  const { data } = await calculate({
    orders: [order(), order({ order_sn: 'SYN-2', confirm_time: null })],
  });
  const item = data.items[0];
  assert.equal(item.order_count, null);
  assert.equal(item.observed_order_count, 1);
  assert.equal(item.revenue_yuan, null);
  assert.equal(item.observed_revenue_yuan, 24);
  assert.equal(item.net_profit_yuan, null);
});

it('keeps signed rates beyond 100 without clamping, and nulls zero denominators', async () => {
  const { data } = await calculate({ entries: [entry({ purchase_fen: 10000 })] });
  const item = data.items[0];
  assert.ok(item.gross_margin_pct < -100);
  assert.ok(item.net_margin_pct < -100);
  const empty = await calculate({ orders: [], promo: promoRaw([], 0) });
  assert.equal(empty.data.summary.net_margin_pct, null);
});

it('handles promo-only goods and missing identities without hiding unknown shop profit', async () => {
  const onlyPromo = await calculate({ orders: [], entries: [] });
  assert.equal(onlyPromo.data.items[0].net_profit_yuan, null);
  const knownCost = await calculate({ orders: [] });
  assert.equal(knownCost.data.items[0].net_profit_yuan, -1);
  const unattributed = await calculate({ orders: [order({ goods_id: null })] });
  assert.equal(unattributed.data.summary.unattributed_order_count, 1);
  assert.equal(unattributed.data.summary.net_profit_yuan, null);
});

it('takes insurance from the platform fee records of the order', async () => {
  const { data } = await calculate({
    insurance: insuranceRaw([fee('SYN-1', '1.11'), fee('SYN-1', '0.12', '待收费'), fee('SYN-OTHER', '9.99')]),
  });
  const item = data.items[0];
  assert.equal(item.insurance_yuan, 1.23);
  assert.equal(item.merchant_cost_yuan, 20.93);
  assert.equal(item.gross_profit_yuan, 3.07);
});

it('keeps charged fees on refunded orders but drops pending fees on refunded or cancelled orders', async () => {
  const pending = insuranceRaw([fee('SYN-1', '0.30', '待收费')]);
  for (const shippingTime of [1700000000, 0, null]) {
    const refunded = order({ after_sales_status: 5, shipping_time: shippingTime });
    assert.equal((await calculate({ orders: [refunded] })).data.items[0].insurance_yuan, 0.3);
  }
  assert.equal((await calculate({ orders: [order({ after_sales_status: 5 })], insurance: pending })).data.items[0].insurance_yuan, 0);
  for (const feeStatus of ['收费成功', '待收费']) {
    const records = insuranceRaw([fee('SYN-1', '0.30', feeStatus)]);
    assert.equal((await calculate({ orders: [order({ pay_status: 0 })], insurance: records })).data.items[0].insurance_yuan, 0);
  }
  for (const afterSales of [null, 10, 11]) {
    const open = order({ after_sales_status: afterSales });
    assert.equal((await calculate({ orders: [open], insurance: pending })).data.items[0].insurance_yuan, 0.3);
  }
});

it('counts orders without a fee record as zero only when the records are complete', async () => {
  const none = await calculate({ insurance: insuranceRaw([]) });
  assert.equal(none.data.items[0].insurance_yuan, 0);
  assert.equal(none.data.items[0].merchant_cost_yuan, 19.7);
  const incomplete = await calculate({ insurance: insuranceRaw([], 10) });
  for (const field of ['insurance_yuan', 'merchant_cost_yuan', 'gross_profit_yuan', 'net_profit_yuan']) {
    assert.equal(incomplete.data.items[0][field], null, field);
    assert.equal(incomplete.data.summary[field], null, field);
  }
  const unavailable = await calculate({ insurance: { status: 500, raw: null } });
  assert.equal(unavailable.data.items[0].insurance_yuan, null);
});

it('keeps an order fee unknown when its amount, fee status or after-sales status is unknown', async () => {
  assert.equal((await calculate({
    insurance: insuranceRaw([{ orderSn: 'SYN-1', serviceAmountVO: { unit: 'FEN', value: '30' }, feeStatusDesc: '收费成功' }]),
  })).data.items[0].insurance_yuan, null);
  assert.equal((await calculate({
    insurance: insuranceRaw([fee('SYN-1', '0.30', '收费取消')]),
  })).data.items[0].insurance_yuan, null);
  assert.equal((await calculate({
    orders: [order({ after_sales_status: 'x' })],
    insurance: insuranceRaw([fee('SYN-1', '0.30', '待收费')]),
  })).data.items[0].insurance_yuan, null);
});

// 与 orders.js 一致：5 = 退款成功，其他非空整数码 = 售后处理中（真实账号出现过 6、31）
it.each([6, 10, 11, 31, 99])('treats after-sales code %s as in after-sales: revenue kept and counted separately', async (code) => {
  const item = (await calculate({ orders: [order({ after_sales_status: code })] })).data.items[0];
  const normal = (await calculate({ orders: [order({ after_sales_status: null })] })).data.items[0];
  assert.equal(item.after_sales_order_count, 1);
  assert.equal(item.refunded_order_count, 0);
  assert.equal(item.revenue_yuan, normal.revenue_yuan);
  assert.equal(item.net_profit_yuan, normal.net_profit_yuan);
  assert.notEqual(item.net_profit_yuan, null);
});
