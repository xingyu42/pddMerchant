import { beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { getGoodsProfitView } from '../../src/services/goods-profit.js';
import { insertAccount } from '../../src/infra/account-store.js';
import { createRateLimiter } from '../../src/adapter/rate-limiter.js';
import { createMemoryEndpointTransport, createTestCtx } from '../helpers/test-ctx.js';

const DAY_MS = 86400000;
const NOW = Date.parse('2026-11-15T02:00:00Z') / 1000;
const IN_WINDOW = Date.parse('2026-11-10T00:00:00Z') / 1000;

const record = (orderSn, overrides = {}) => ({
  orderSn,
  serviceAmountVO: { unit: 'YUAN', value: '1.11' },
  feeStatusDesc: '收费成功',
  ...overrides,
});
const insuranceRaw = (total, orderInsurances) => ({
  success: true,
  errorCode: 0,
  result: { total, orderInsurances },
});
const order = (orderSn, goodsId = '101') => ({
  order_sn: orderSn,
  goods_id: goodsId,
  goods_name: 'Tea',
  goods_number: 1,
  order_amount: 1000,
  platform_discount: 0,
  after_sales_status: null,
  shipping_time: 1700000000,
  pay_status: 2,
  confirm_time: IN_WINDOW,
});

let activeAccount;
let transport;
let ctx;
const insuranceCalls = () => transport.calls.filter((call) => call.name === 'experiencePlan.orderInsuranceList');
const insuranceBodies = () => insuranceCalls().map((call) => call.payload);

function setOrders(orders) {
  transport.set('orders.list', { success: true, result: { totalItemNum: orders.length, pageItems: orders } });
}

async function runProfit(days = 7, targetCtx = ctx) {
  let settled;
  const pending = (async () => {
    try {
      settled = { ok: true, value: await getGoodsProfitView(targetCtx, { days }) };
    } catch (error) {
      settled = { ok: false, error };
    }
  })();
  await vi.runAllTimersAsync();
  await pending;
  if (!settled.ok) throw settled.error;
  return settled.value;
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW * 1000 });
  activeAccount = insertAccount({ kind: 'merchant', identity: '900001', displayName: 'Synthetic Shop' }, { setDefault: true });
  transport = createMemoryEndpointTransport({
    responses: {
      'orders.list': { success: true, result: { totalItemNum: 0, pageItems: [] } },
      'promo.entityReport': {
        success: true,
        result: { entityReportList: [], totalSumReport: { impression: 0, click: 0, gmv: 0, spend: 0 } },
      },
    },
  });
  ctx = createTestCtx({
    transport,
    accountId: activeAccount.id,
    account: activeAccount,
    mallId: '900001',
    limiter: createRateLimiter({ qps: 0 }),
  });
});

it('requests pending and charged records created from one day before the window to its end, 100 per page', async () => {
  setOrders([order('SYN-1', '101'), order('SYN-2', '102')]);
  transport.set('experiencePlan.orderInsuranceList',
    insuranceRaw(2, [record('SYN-1'), record('SYN-2', { feeStatusDesc: '待收费' })]));
  const result = await runProfit(7);
  assert.deepEqual(insuranceBodies(), [{
    pageSize: 100,
    pageNumber: 0,
    queryFeeStatusList: [1, 2],
    clientType: 1,
    createBeginTime: Date.parse('2026-11-06T16:00:00Z'),
    createEndTime: Date.parse('2026-11-14T16:00:00Z') - 1,
  }]);
  assert.equal(result.data.summary.data_quality.insurance_complete, true);
  assert.equal(result.data.summary.data_quality.insurance_truncated, false);
  assert.equal(result.meta.xhr_count, 3);
  assert.equal(result.data.items.find((item) => item.goods_id === '101').insurance_yuan, 1.11);
  assert.equal(result.data.items.find((item) => item.goods_id === '102').insurance_yuan, 1.11);
});

it('splits windows longer than 30 days into contiguous spans of at most 30 days', async () => {
  transport.set('experiencePlan.orderInsuranceList', insuranceRaw(0, []));
  await runProfit(90);
  const spans = insuranceBodies();
  const windowEnd = Date.parse('2026-11-14T16:00:00Z') - 1;
  const windowStart = Date.parse('2026-08-16T16:00:00Z');
  assert.equal(spans.length, 4);
  assert.equal(spans[0].createBeginTime, windowStart - DAY_MS);
  assert.equal(spans.at(-1).createEndTime, windowEnd);
  for (const [index, body] of spans.entries()) {
    assert.equal(body.pageNumber, 0);
    assert.ok(body.createEndTime - body.createBeginTime + 1 <= 30 * DAY_MS);
    if (index > 0) assert.equal(body.createBeginTime, spans[index - 1].createEndTime + 1);
  }
});

it('pages each span until total is reached and sums repeated records of one order', async () => {
  setOrders([order('SYN-0', '101')]);
  transport.queue(
    'experiencePlan.orderInsuranceList',
    insuranceRaw(101, Array.from({ length: 100 }, (unused, index) => record(`SYN-${index}`))),
    insuranceRaw(101, [record('SYN-0', { serviceAmountVO: { unit: 'YUAN', value: '0.5' } })]),
  );
  const result = await runProfit(7);
  assert.deepEqual(insuranceBodies().map((body) => body.pageNumber), [0, 1]);
  assert.equal(result.data.summary.data_quality.insurance_complete, true);
  assert.equal(result.data.items[0].insurance_yuan, 1.61);
});

it('marks a page cap, a short page or a drifting total incomplete', async () => {
  const full = insuranceRaw(5100, Array.from({ length: 100 }, (unused, index) => record(`SYN-${index}`)));
  transport.set('experiencePlan.orderInsuranceList', full);
  const capped = await runProfit(7);
  assert.equal(capped.data.summary.data_quality.insurance_truncated, true);
  assert.equal(capped.data.summary.data_quality.insurance_complete, false);
  assert.ok(capped.data.hints.includes('运费险收费记录不完整或超出采集上限，运费险、商家成本和利润为 null'));

  const shortFull = insuranceRaw(300, Array.from({ length: 100 }, (unused, index) => record(`SYN-${index}`)));
  transport.queue('experiencePlan.orderInsuranceList', shortFull, insuranceRaw(300, []));
  assert.equal((await runProfit(7)).data.summary.data_quality.insurance_complete, false);

  transport.queue('experiencePlan.orderInsuranceList', shortFull, insuranceRaw(301, shortFull.result.orderInsurances));
  assert.equal((await runProfit(7)).data.summary.data_quality.insurance_complete, false);
});

it('treats upstream failures as an unavailable optional source', async () => {
  for (const outcome of [
    { success: false, errorCode: 54001, errorMsg: 'rate limit' },
    { status: 500, raw: null },
    { success: false, errorCode: 40001, errorMsg: 'business error' },
  ]) {
    const caseCtx = createTestCtx({
      accountId: activeAccount.id,
      account: activeAccount,
      mallId: '900001',
      limiter: createRateLimiter({ qps: 0 }),
      responses: {
        'orders.list': { success: true, result: { totalItemNum: 0, pageItems: [] } },
        'promo.entityReport': {
          success: true,
          result: { entityReportList: [], totalSumReport: { impression: 0, click: 0, gmv: 0, spend: 0 } },
        },
        'experiencePlan.orderInsuranceList': outcome,
      },
    });
    const result = await runProfit(7, caseCtx);
    assert.equal(result.data.summary.data_quality.insurance_complete, false);
    assert.equal(result.data.summary.data_quality.insurance_truncated, false);
    assert.ok(result.data.hints.includes('运费险收费记录拉取失败，运费险、商家成本和利润为 null'));
  }
  transport.fail('experiencePlan.orderInsuranceList', new TypeError('bug'));
  await assert.rejects(() => runProfit(7), TypeError);
});

it('keeps non-YUAN amounts and unknown fee statuses unknown with warnings', async () => {
  setOrders([order('SYN-1', '101'), order('SYN-2', '102')]);
  transport.set('experiencePlan.orderInsuranceList', insuranceRaw(3, [
    record('SYN-1', { serviceAmountVO: { unit: 'FEN', value: '111' } }),
    record('SYN-2', { feeStatusDesc: '收费取消' }),
    record('SYN-3', { serviceAmountVO: { unit: 'FEN', value: '1' } }),
  ]));
  const result = await runProfit(7);
  assert.equal(result.data.items.find((item) => item.goods_id === '101').insurance_yuan, null);
  assert.equal(result.data.items.find((item) => item.goods_id === '102').insurance_yuan, null);
  assert.equal(result.data.summary.data_quality.insurance_complete, true);
  assert.equal(result.warnings.length, 2);
  assert.ok(result.warnings.some((warning) => warning.includes('FEN')));
  assert.ok(result.warnings.some((warning) => warning.includes('收费取消')));
});
