import { it } from 'vitest';
import assert from 'node:assert/strict';
import { createCostCli, costArgs } from '../helpers/goods-cost-cli.js';
import { createProfitFixtures, createProfitOrders, createUpstreamOrderInsurance } from '../fixtures/test-data.js';
import { runCli } from '../helpers/isolated-cli.js';

function profit(fixtures, { costs = true, extraCosts = [], args = [] } = {}) {
  const cli = createCostCli(fixtures);
  try {
    if (costs) assert.equal(cli.execute(['goods', 'cost', 'set', ...costArgs, ...extraCosts, '--confirm']).envelope.ok, true);
    const result = cli.execute(['goods', 'profit', ...args]);
    assert.equal(result.envelope.ok, true, JSON.stringify(result.envelope.error));
    assert.equal(result.status, 0);
    return result.envelope;
  } finally { cli.dispose(); }
}

function report(fixtures, options) {
  return profit(fixtures, options).data;
}

// 收费记录按创建时间从窗口起点前 1 天查起：--days 29 时恰为一段 30 天的请求，fixture 不会被第二段重复读取。
const fee = (orderSn, value, overrides = {}) => createUpstreamOrderInsurance({ orderSn, sn: `${orderSn}-MI`,
  serviceAmountVO: { unit: 'YUAN', value, unitCode: 1 }, ...overrides });
const insuranceReport = (insurance, { orders = createProfitOrders(), extraCosts = [] } = {}) =>
  profit(createProfitFixtures({ orders, insurance }), { extraCosts, args: ['--days', '29'] });

it('takes insurance from the platform fee records of each order and ignores the manual entry value', () => {
  const { data } = insuranceReport([fee('SYN-PROFIT-0', '1.11'), fee('SYN-OTHER', '5.00')],
    { extraCosts: ['--insurance-yuan', '9'] });
  assert.equal(data.items[0].insurance_yuan, 1.11);
  assert.equal(data.items[0].net_profit_yuan, 1.99);
  assert.equal(data.summary.insurance_yuan, 1.11);
  assert.equal(data.summary.data_quality.insurance_complete, true);
  assert.equal(data.summary.data_quality.insurance_truncated, false);
  assert.ok(data.hints.some((hint) => hint.includes('收费记录')));
});

it('keeps a charged fee on a refunded order and drops a pending one', () => {
  const orders = createProfitOrders([{ after_sales_status: 5, shipping_time: 1700000000 }]);
  assert.equal(insuranceReport([fee('SYN-PROFIT-0', '1.11')], { orders }).data.items[0].insurance_yuan, 1.11);
  const pending = insuranceReport([fee('SYN-PROFIT-0', '1.11', { feeStatusDesc: '待收费' })], { orders });
  assert.equal(pending.data.items[0].insurance_yuan, 0);
});

it('counts orders without a record, or an empty record list, as zero', () => {
  assert.equal(insuranceReport([fee('SYN-OTHER', '1.11')]).data.items[0].insurance_yuan, 0);
  const empty = report(createProfitFixtures());
  assert.equal(empty.items[0].insurance_yuan, 0);
  assert.equal(empty.summary.insurance_yuan, 0);
  assert.equal(empty.items[0].net_profit_yuan, 3.1);
});

it('nulls insurance-dependent amounts with a hint when fee records fail or are incomplete, exit code 0', () => {
  const failed = createProfitFixtures();
  failed['endpoints/experiencePlan.orderInsuranceList.json'] = { __throws: true, __error: { code: 'E_NETWORK', exitCode: 5 } };
  const short = createProfitFixtures({ insurance: [fee('SYN-PROFIT-0', '1.11')] });
  short['endpoints/experiencePlan.orderInsuranceList.json'].result.total = 101;
  for (const [fixtures, hint] of [[failed, '拉取失败'], [short, '不完整']]) {
    const data = report(fixtures, { args: ['--days', '29'] });
    for (const field of ['insurance_yuan', 'merchant_cost_yuan', 'gross_profit_yuan', 'net_profit_yuan']) {
      assert.equal(data.items[0][field], null, field);
      assert.equal(data.summary[field], null, field);
    }
    assert.equal(data.items[0].revenue_yuan, 24);
    assert.equal(data.summary.data_quality.insurance_complete, false);
    assert.equal(data.summary.data_quality.insurance_truncated, false);
    assert.ok(data.hints.some((text) => text.includes('运费险') && text.includes(hint)), hint);
  }
});

it('keeps a non-YUAN fee unknown with a warning', () => {
  const envelope = insuranceReport([fee('SYN-PROFIT-0', '111', { serviceAmountVO: { unit: 'FEN', value: '111' } })]);
  assert.equal(envelope.data.items[0].insurance_yuan, null);
  assert.equal(envelope.data.items[0].net_profit_yuan, null);
  assert.ok(envelope.meta.warnings.some((warning) => warning.includes('FEN')));
});

it('connects cost storage to revenue, attributed spend and full-shop totals without advice or raw data', () => {
  const data = report(createProfitFixtures());
  assert.equal(data.items[0].revenue_yuan, 24);
  assert.equal(data.items[0].net_profit_yuan, 3.1);
  assert.equal(data.summary.platform_discount_yuan, 0.5);
  assert.equal(data.summary.promo_spend_yuan, 1.5);
  assert.equal(data.summary.shop_promo_spend_yuan, 0.5);
  assert.equal(data.summary.net_profit_yuan, 2.6);
  assert.equal(data.items[0].default_fallback_order_count, 1);
  for (const forbidden of ['break_even', 'profit_class', 'SYN-RECEIVER', 'receive_mobile', 'buyer_memo', 'raw', '建议', '亏损商品']) {
    assert.equal(JSON.stringify(data).includes(forbidden), false, forbidden);
  }
});

it('keeps unknown costs null rather than assuming free goods', () => {
  const data = report(createProfitFixtures(), { costs: false });
  assert.equal(data.items[0].net_profit_yuan, null);
  assert.equal(data.summary.net_profit_yuan, null);
});

it.each(['0', '100'])('preserves long IDs and signed profit with purchase cost %s', (purchase) => {
  const goodsId = '90071992547409999';
  const fixtures = createProfitFixtures({ orders: createProfitOrders([{ goods_id: goodsId }]),
    entities: [{ goodsId, goodsName: 'Tea', spend: 1, gmv: 24, impression: 10, click: 1 }] });
  const data = report(fixtures, { extraCosts: ['--goods-id', goodsId, '--purchase-yuan', purchase,
    '--packaging-yuan', '0', '--courier-yuan', '0'], args: ['--goods-id', goodsId] });
  assert.equal(data.items[0].goods_id, goodsId);
  assert.equal(data.items[0].merchant_cost_yuan, Number(purchase) * 2);
  assert.equal(data.items[0].net_profit_yuan, purchase === '0' ? 23 : -177);
  assert.equal(data.items[0].net_margin_pct, purchase === '0' ? 95.83 : -737.5);
});

it.each([0, 1700000000, null])('applies all per-order refund costs using shipping_time=%s', (shippingTime) => {
  const data = report(createProfitFixtures({ orders: createProfitOrders([{ after_sales_status: 5, shipping_time: shippingTime }]) }),
    { extraCosts: ['--insurance-yuan', '0.3', '--technical-service-yuan', '0.2'] });
  assert.equal(data.items[0].revenue_yuan, 0);
  assert.equal(data.items[0].purchase_yuan, 0);
  // 运费险取收费记录（此处无记录为 0），手填 0.3 不计入
  assert.equal(data.items[0].merchant_cost_yuan, shippingTime === null ? null : shippingTime === 0 ? 0 : 3.7);
});

it.each([10, 11])('reports open after-sales %s normally and separately', (status) => {
  const data = report(createProfitFixtures({ orders: createProfitOrders([{ after_sales_status: status }]) }));
  assert.equal(data.items[0].net_profit_yuan, 3.1);
  assert.equal(data.summary.after_sales_order_count, 1);
  assert.equal(data.summary.after_sales_revenue_yuan, 24);
});

it('distinguishes unavailable promotion, absent goods records and negative residuals', () => {
  const missing = createProfitFixtures();
  missing['endpoints/promo.entityReport.json'] = { __throws: true, __error: { code: 'E_NETWORK', exitCode: 5 } };
  assert.equal(report(missing).items[0].net_profit_yuan, null);
  assert.equal(report(createProfitFixtures({ entities: [], totalSpend: 0 })).items[0].promo_spend_yuan, 0);
  const negative = report(createProfitFixtures({ totalSpend: 0.5 }));
  assert.equal(negative.summary.shop_promo_spend_yuan, null);
  assert.equal(negative.summary.net_profit_yuan, 3.6);
  assert.ok(negative.hints.some((hint) => hint.includes('差额为负')));
});

it('returns unknown full-window amounts when order collection is rate limited', () => {
  const fixtures = createProfitFixtures({ orders: createProfitOrders(Array.from({ length: 50 }, () => ({}))) });
  fixtures['endpoints/orders.list.page2.json'] = { __throws: true, __error: { code: 'E_RATE_LIMIT', exitCode: 4 } };
  const data = report(fixtures);
  assert.equal(data.summary.data_quality.orders_ratelimited, true);
  assert.equal(data.summary.observed_order_count, 50);
  assert.equal(data.summary.net_profit_yuan, null);
});

it('filters goods without changing full-shop totals, including an explicitly empty goods ID', () => {
  const cli = createCostCli(createProfitFixtures());
  try {
    cli.execute(['goods', 'cost', 'set', ...costArgs, '--confirm']);
    const baseline = cli.execute(['goods', 'profit']).envelope.data;
    const filtered = cli.execute(['goods', 'profit', '--goods-id', '102']).envelope.data;
    assert.deepEqual(filtered.summary, baseline.summary);
    assert.equal(filtered.items[0].goods_id, '102');
    assert.equal(filtered.items[0].order_count, 0);
  } finally { cli.dispose(); }
});

it('uses a precise spec override and falls back for an unmatched spec', () => {
  const cli = createCostCli(createProfitFixtures({ orders: createProfitOrders([{ spec: 'red' }, { spec: 'red ' }]) }));
  try {
    cli.execute(['goods', 'cost', 'set', ...costArgs, '--confirm']);
    const override = [...costArgs];
    override[override.indexOf('--purchase-yuan') + 1] = '10';
    cli.execute(['goods', 'cost', 'set', ...override, '--spec', 'red', '--confirm']);
    const data = cli.execute(['goods', 'profit']).envelope.data;
    assert.equal(data.items[0].purchase_yuan, 36.4);
    assert.equal(data.items[0].default_fallback_order_count, 1);
    assert.equal(data.items[0].net_profit_yuan, 3.6);
  } finally { cli.dispose(); }
});

it('excludes unpaid cancelled orders without a confirm_time and keeps empty windows explicit', () => {
  const cancelled = report(createProfitFixtures({ orders: createProfitOrders([{}, { pay_status: 0, confirm_time: 0 }]) }));
  assert.equal(cancelled.summary.observed_order_count, 1);
  assert.equal(cancelled.summary.data_quality.orders_complete, true);
  assert.equal(cancelled.items[0].net_profit_yuan, 3.1);
  const empty = report(createProfitFixtures({ orders: [], entities: [], totalSpend: 0 }));
  assert.equal(empty.total, 0);
  assert.equal(empty.summary.net_profit_yuan, 0);
  assert.equal(empty.summary.net_margin_pct, null);
});

it('marks orders carrying only group_time incomplete with a hint', () => {
  // JSON fixture 会丢掉 undefined 字段：第二单只有成团时间（订单详情形态），没有成交时间
  const orders = createProfitOrders([{}, { confirm_time: undefined, group_time: Math.floor(Date.now() / 1000) - 86400 }]);
  const data = report(createProfitFixtures({ orders }));
  assert.equal(data.summary.data_quality.orders_complete, false);
  assert.equal(data.summary.observed_order_count, 1);
  assert.equal(data.summary.net_profit_yuan, null);
  assert.ok(data.hints.includes('成交时间缺失或重复订单事实冲突，订单采集不完整'), JSON.stringify(data.hints));
});

it('marks capped order scans incomplete instead of reporting a full-window profit', () => {
  const fixtures = createProfitFixtures({ orders: createProfitOrders(Array.from({ length: 50 }, () => ({}))) });
  for (let page = 2; page <= 15; page += 1) {
    fixtures[`endpoints/orders.list.page${page}.json`] = { success: true, result: {
      pageItems: createProfitOrders(Array.from({ length: 50 }, (unused, index) => ({ order_sn: `SYN-${page}-${index}` }))), totalItemNum: 800,
    } };
  }
  const data = report(fixtures);
  assert.equal(data.summary.data_quality.orders_truncated, true);
  assert.equal(data.summary.observed_order_count, 750);
  assert.equal(data.summary.net_profit_yuan, null);
});

it.each(['0', '91', '-1', '1.5', 'abc'])('rejects --days %s with E_USAGE', (days) => {
  const result = runCli(['goods', 'profit', '--days', days], { fixtures: createProfitFixtures() });
  assert.equal(result.status, 2);
  assert.equal(result.envelope.error.code, 'E_USAGE');
});

it.each(['1', '90'])('accepts --days boundary %s', (days) => {
  assert.equal(report(createProfitFixtures(), { args: ['--days', days] }).window.days, Number(days));
});
