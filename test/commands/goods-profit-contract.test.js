import assert from 'node:assert/strict';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { run as goodsProfit } from '../../src/commands/goods/profit.js';
import { run as goodsCostSet } from '../../src/commands/goods/cost/set.js';
import { clearFixtureCache } from '../../src/adapter/mock-dispatcher.js';
import { _resetRateLimitState } from '../../src/adapter/run-endpoint.js';
import { openDatabase, closeDatabase } from '../../src/infra/db.js';
import { createCliSandbox, runtimeConfig } from '../helpers/isolated-cli.js';
import { seedDb, DEFAULT_ACCOUNT } from '../helpers/seed-db.js';
import { createProfitFixtures, createProfitOrders, createUpstreamOrderInsurance } from '../fixtures/test-data.js';

// 进程内跑 goods cost set / goods profit 的完整命令链（withCommand → fixture transport → 服务 → 视图），
// 利润计算的各分支在这里断言。单行 JSON、退出码与参数解析由 test/e2e/goods-profit.e2e.test.js 以子进程守卫。

const { emitSpy } = vi.hoisted(() => ({ emitSpy: vi.fn() }));
vi.mock('../../src/infra/output.js', async (importOriginal) => ({
  ...await importOriginal(), emit: emitSpy,
}));

const COSTS = { goodsId: '101', purchaseYuan: '8.2', packagingYuan: '0.5', courierYuan: '3' };
const sandboxes = [];

beforeEach(() => {
  _resetRateLimitState();
});
afterEach(() => {
  clearFixtureCache();
  _resetRateLimitState();
  closeDatabase();
  for (const sandbox of sandboxes.splice(0)) sandbox.dispose();
});

// 每次调用一个独立沙箱：自己的 fixture 目录和已登记默认账号的临时库。
function useShop(fixtures) {
  const sandbox = createCliSandbox(fixtures);
  sandboxes.push(sandbox);
  seedDb(sandbox.env.PDD_DB_PATH, { accounts: [DEFAULT_ACCOUNT] });
  openDatabase(sandbox.env.PDD_DB_PATH);
  for (const [key, value] of Object.entries(sandbox.env)) {
    if (key.startsWith('PDD_')) vi.stubEnv(key, value);
  }
  clearFixtureCache();
}

async function invoke(run, opts) {
  emitSpy.mockClear();
  const envelope = await run({ json: true, timeoutMs: 10000, ...opts }, { runtimeConfig });
  assert.equal(emitSpy.mock.calls.length, 1);
  return JSON.parse(JSON.stringify(envelope)); // 与 stdout 上的 JSON 同形
}

async function setCost(overrides = {}) {
  const envelope = await invoke(goodsCostSet, { ...COSTS, ...overrides, confirm: true });
  assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
}

async function readProfit(opts = {}) {
  const envelope = await invoke(goodsProfit, opts);
  assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
  return envelope;
}

async function profit(fixtures, { costs = true, extraCosts = {}, opts = {} } = {}) {
  useShop(fixtures);
  if (costs) await setCost(extraCosts);
  return readProfit(opts);
}

async function report(fixtures, options) {
  return (await profit(fixtures, options)).data;
}

// 收费记录按创建时间从窗口起点前 1 天查起：days=29 时恰为一段 30 天的请求，fixture 不会被第二段重复读取。
const fee = (orderSn, value, overrides = {}) => createUpstreamOrderInsurance({ orderSn, sn: `${orderSn}-MI`,
  serviceAmountVO: { unit: 'YUAN', value, unitCode: 1 }, ...overrides });
const insuranceReport = (insurance, { orders = createProfitOrders(), extraCosts = {} } = {}) =>
  profit(createProfitFixtures({ orders, insurance }), { extraCosts, opts: { days: 29 } });

it('takes insurance from the platform fee records of each order', async () => {
  const { data } = await insuranceReport([fee('SYN-PROFIT-0', '1.11'), fee('SYN-OTHER', '5.00')]);
  assert.equal(data.items[0].insurance_yuan, 1.11);
  assert.equal(data.items[0].net_profit_yuan, 1.99);
  assert.equal(data.summary.insurance_yuan, 1.11);
  assert.equal(data.summary.data_quality.insurance_complete, true);
  assert.equal(data.summary.data_quality.insurance_truncated, false);
  assert.ok(data.hints.some((hint) => hint.includes('收费记录')));
});

it('keeps a charged fee on a refunded order and drops a pending one', async () => {
  const orders = createProfitOrders([{ after_sales_status: 5, shipping_time: 1700000000 }]);
  assert.equal((await insuranceReport([fee('SYN-PROFIT-0', '1.11')], { orders })).data.items[0].insurance_yuan, 1.11);
  const pending = await insuranceReport([fee('SYN-PROFIT-0', '1.11', { feeStatusDesc: '待收费' })], { orders });
  assert.equal(pending.data.items[0].insurance_yuan, 0);
});

it('counts orders without a record, or an empty record list, as zero', async () => {
  assert.equal((await insuranceReport([fee('SYN-OTHER', '1.11')])).data.items[0].insurance_yuan, 0);
  const empty = await report(createProfitFixtures());
  assert.equal(empty.items[0].insurance_yuan, 0);
  assert.equal(empty.summary.insurance_yuan, 0);
  assert.equal(empty.items[0].net_profit_yuan, 3.1);
});

it('nulls insurance-dependent amounts with a hint when fee records fail or are incomplete', async () => {
  const failed = createProfitFixtures();
  failed['endpoints/experiencePlan.orderInsuranceList.json'] = { __throws: true, __error: { code: 'E_NETWORK', exitCode: 5 } };
  const short = createProfitFixtures({ insurance: [fee('SYN-PROFIT-0', '1.11')] });
  short['endpoints/experiencePlan.orderInsuranceList.json'].result.total = 101;
  for (const [fixtures, hint] of [[failed, '拉取失败'], [short, '不完整']]) {
    const data = await report(fixtures, { opts: { days: 29 } });
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

it('keeps a non-YUAN fee unknown with a warning', async () => {
  const envelope = await insuranceReport([fee('SYN-PROFIT-0', '111', { serviceAmountVO: { unit: 'FEN', value: '111' } })]);
  assert.equal(envelope.data.items[0].insurance_yuan, null);
  assert.equal(envelope.data.items[0].net_profit_yuan, null);
  assert.ok(envelope.meta.warnings.some((warning) => warning.includes('FEN')));
});

it('connects cost storage to revenue, attributed spend and full-shop totals without advice or raw data', async () => {
  const data = await report(createProfitFixtures());
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

it('keeps unknown costs null rather than assuming free goods', async () => {
  const data = await report(createProfitFixtures(), { costs: false });
  assert.equal(data.items[0].net_profit_yuan, null);
  assert.equal(data.summary.net_profit_yuan, null);
});

it.each(['0', '100'])('preserves long IDs and signed profit with purchase cost %s', async (purchase) => {
  const goodsId = '90071992547409999';
  const fixtures = createProfitFixtures({ orders: createProfitOrders([{ goods_id: goodsId }]),
    entities: [{ goodsId, goodsName: 'Tea', spend: 1, gmv: 24, impression: 10, click: 1 }] });
  const data = await report(fixtures, { extraCosts: { goodsId, purchaseYuan: purchase, packagingYuan: '0', courierYuan: '0' },
    opts: { goodsId } });
  assert.equal(data.items[0].goods_id, goodsId);
  assert.equal(data.items[0].merchant_cost_yuan, Number(purchase) * 2);
  assert.equal(data.items[0].net_profit_yuan, purchase === '0' ? 23 : -177);
  assert.equal(data.items[0].net_margin_pct, purchase === '0' ? 95.83 : -737.5);
});

it.each([0, 1700000000, null])('applies all per-order refund costs using shipping_time=%s', async (shippingTime) => {
  const data = await report(createProfitFixtures({ orders: createProfitOrders([{ after_sales_status: 5, shipping_time: shippingTime }]) }),
    { extraCosts: { technicalServiceYuan: '0.2' } });
  assert.equal(data.items[0].revenue_yuan, 0);
  assert.equal(data.items[0].purchase_yuan, 0);
  // 运费险取收费记录（此处无记录为 0）
  assert.equal(data.items[0].merchant_cost_yuan, shippingTime === null ? null : shippingTime === 0 ? 0 : 3.7);
});

it.each([10, 11])('reports open after-sales %s normally and separately', async (status) => {
  const data = await report(createProfitFixtures({ orders: createProfitOrders([{ after_sales_status: status }]) }));
  assert.equal(data.items[0].net_profit_yuan, 3.1);
  assert.equal(data.summary.after_sales_order_count, 1);
  assert.equal(data.summary.after_sales_revenue_yuan, 24);
});

it('distinguishes unavailable promotion, absent goods records and negative residuals', async () => {
  const missing = createProfitFixtures();
  missing['endpoints/promo.entityReport.json'] = { __throws: true, __error: { code: 'E_NETWORK', exitCode: 5 } };
  assert.equal((await report(missing)).items[0].net_profit_yuan, null);
  assert.equal((await report(createProfitFixtures({ entities: [], totalSpend: 0 }))).items[0].promo_spend_yuan, 0);
  const negative = await report(createProfitFixtures({ totalSpend: 0.5 }));
  assert.equal(negative.summary.shop_promo_spend_yuan, null);
  assert.equal(negative.summary.net_profit_yuan, 3.6);
  assert.ok(negative.hints.some((hint) => hint.includes('差额为负')));
});

it('returns unknown full-window amounts when order collection is rate limited', async () => {
  const fixtures = createProfitFixtures({ orders: createProfitOrders(Array.from({ length: 50 }, () => ({}))) });
  fixtures['endpoints/orders.list.page2.json'] = { __throws: true, __error: { code: 'E_RATE_LIMIT', exitCode: 4 } };
  const data = await report(fixtures);
  assert.equal(data.summary.data_quality.orders_ratelimited, true);
  assert.equal(data.summary.observed_order_count, 50);
  assert.equal(data.summary.net_profit_yuan, null);
});

it('filters goods without changing full-shop totals, including an explicitly empty goods ID', async () => {
  useShop(createProfitFixtures());
  await setCost();
  const baseline = (await readProfit()).data;
  const filtered = (await readProfit({ goodsId: '102' })).data;
  assert.deepEqual(filtered.summary, baseline.summary);
  assert.equal(filtered.items[0].goods_id, '102');
  assert.equal(filtered.items[0].order_count, 0);
});

it('uses a precise spec override and falls back for an unmatched spec', async () => {
  useShop(createProfitFixtures({ orders: createProfitOrders([{ spec: 'red' }, { spec: 'red ' }]) }));
  await setCost();
  await setCost({ purchaseYuan: '10', spec: 'red' });
  const { data } = await readProfit();
  assert.equal(data.items[0].purchase_yuan, 36.4);
  assert.equal(data.items[0].default_fallback_order_count, 1);
  assert.equal(data.items[0].net_profit_yuan, 3.6);
});

it('excludes unpaid cancelled orders without a confirm_time and keeps empty windows explicit', async () => {
  const cancelled = await report(createProfitFixtures({ orders: createProfitOrders([{}, { pay_status: 0, confirm_time: 0 }]) }));
  assert.equal(cancelled.summary.observed_order_count, 1);
  assert.equal(cancelled.summary.data_quality.orders_complete, true);
  assert.equal(cancelled.items[0].net_profit_yuan, 3.1);
  const empty = await report(createProfitFixtures({ orders: [], entities: [], totalSpend: 0 }));
  assert.equal(empty.total, 0);
  assert.equal(empty.summary.net_profit_yuan, 0);
  assert.equal(empty.summary.net_margin_pct, null);
});

it('marks orders carrying only group_time incomplete with a hint', async () => {
  // JSON fixture 会丢掉 undefined 字段：第二单只有成团时间（订单详情形态），没有成交时间
  const orders = createProfitOrders([{}, { confirm_time: undefined, group_time: Math.floor(Date.now() / 1000) - 86400 }]);
  const data = await report(createProfitFixtures({ orders }));
  assert.equal(data.summary.data_quality.orders_complete, false);
  assert.equal(data.summary.observed_order_count, 1);
  assert.equal(data.summary.net_profit_yuan, null);
  assert.ok(data.hints.includes('成交时间缺失或重复订单事实冲突，订单采集不完整'), JSON.stringify(data.hints));
});

it('marks capped order scans incomplete instead of reporting a full-window profit', async () => {
  const fixtures = createProfitFixtures({ orders: createProfitOrders(Array.from({ length: 50 }, () => ({}))) });
  for (let page = 2; page <= 15; page += 1) {
    fixtures[`endpoints/orders.list.page${page}.json`] = { success: true, result: {
      pageItems: createProfitOrders(Array.from({ length: 50 }, (unused, index) => ({ order_sn: `SYN-${page}-${index}` }))), totalItemNum: 800,
    } };
  }
  const data = await report(fixtures);
  assert.equal(data.summary.data_quality.orders_truncated, true);
  assert.equal(data.summary.observed_order_count, 750);
  assert.equal(data.summary.net_profit_yuan, null);
});
