import { beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { getGoodsProfitView } from '../../src/services/goods-profit.js';
import { insertAccount } from '../../src/infra/account-store.js';
import { createRateLimiter } from '../../src/adapter/rate-limiter.js';
import { createMemoryEndpointTransport, createTestCtx } from '../helpers/test-ctx.js';

const NOW_MS = Date.parse('2026-11-15T02:00:00Z');
const entity = (overrides = {}) => ({
  goodsId: '101', impression: 1, click: 1, gmv: 1, spend: 1, isDeleted: true, ...overrides,
});
const promoRaw = (entities, spend = 0) => ({
  success: true,
  result: {
    entityReportList: entities,
    totalSumReport: { impression: 0, click: 0, gmv: 0, spend },
  },
});

let activeAccount;
let transport;
let ctx;

async function runProfit(targetCtx = ctx, days = 29) {
  const pending = getGoodsProfitView(targetCtx, { days });
  await vi.runAllTimersAsync();
  return pending;
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW_MS });
  activeAccount = insertAccount({ kind: 'merchant', identity: '900001', displayName: 'Synthetic Shop' }, { setDefault: true });
  transport = createMemoryEndpointTransport({
    responses: {
      'orders.list': { success: true, result: { totalItemNum: 0, pageItems: [] } },
      'experiencePlan.orderInsuranceList': { success: true, errorCode: 0, result: { total: 0, orderInsurances: [] } },
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

it('aggregates all pages, retains inactive history and subtracts attribution only once', async () => {
  transport.queue(
    'promo.entityReport',
    promoRaw(Array(50).fill(entity()), 80),
    promoRaw([entity({ goodsId: '102', spend: 10 }), entity({ goodsId: null, spend: 20 })], 80),
  );
  const { data } = await runProfit();
  assert.equal(data.summary.data_quality.promo_complete, true);
  assert.equal(data.items.find((item) => item.goods_id === '101').promo_spend_yuan, 50);
  assert.equal(data.items.find((item) => item.goods_id === '102').promo_spend_yuan, 10);
  assert.equal(data.summary.promo_spend_yuan, 80);
  assert.equal(data.summary.shop_promo_spend_yuan, 20);
  assert.equal(data.items.some((item) => item.goods_id === 'Tea'), false);
});

it('preserves totals and marks a negative residual unknown with a hint', async () => {
  transport.set('promo.entityReport', promoRaw([entity({ spend: 2 })], 1));
  const { data } = await runProfit();
  assert.equal(data.summary.promo_spend_yuan, 1);
  assert.equal(data.summary.shop_promo_spend_yuan, null);
  assert.ok(data.hints.includes('推广报表总计减商品归属合计的差额为负，店铺级推广花费为 null'));
});

it('distinguishes a successful empty report from unavailable or invalid spend', async () => {
  transport.set('promo.entityReport', promoRaw([], 0));
  assert.equal((await runProfit()).data.summary.data_quality.promo_complete, true);

  transport.set('promo.entityReport', { status: 500, raw: null });
  assert.equal((await runProfit()).data.summary.promo_spend_yuan, null);

  transport.set('promo.entityReport', promoRaw([entity({ spend: { value: 1, unit: 'UNKNOWN' } })], 1));
  const unknown = await runProfit();
  assert.equal(unknown.data.items[0].promo_spend_yuan, null);
  assert.equal(unknown.data.summary.attributed_promo_spend_yuan, null);
  assert.ok(unknown.warnings.some((warning) => warning.includes('UNKNOWN')));
});

it('propagates capped scans, rate limits and drifting totals', async () => {
  transport.set('promo.entityReport', promoRaw(Array(50).fill(entity()), 50));
  assert.equal((await runProfit()).data.summary.data_quality.promo_truncated, true);

  transport.set('promo.entityReport', { success: false, errorCode: 54001, errorMsg: 'rate limited' });
  assert.equal((await runProfit()).data.summary.data_quality.promo_ratelimited, true);

  const account = insertAccount({ kind: 'merchant', identity: '900002', displayName: 'Drift Shop' });
  const driftTransport = createMemoryEndpointTransport({
    responses: {
      'orders.list': { success: true, result: { totalItemNum: 0, pageItems: [] } },
      'experiencePlan.orderInsuranceList': { success: true, errorCode: 0, result: { total: 0, orderInsurances: [] } },
    },
  });
  const driftCtx = createTestCtx({
    transport: driftTransport,
    accountId: account.id,
    account,
    mallId: '900002',
    limiter: createRateLimiter({ qps: 0 }),
  });
  driftTransport.queue(
    'promo.entityReport',
    promoRaw(Array(50).fill(entity()), 50),
    promoRaw([], 60),
  );
  assert.equal((await runProfit(driftCtx)).data.summary.data_quality.promo_complete, false);
});

it('retains observed identities and the actual request count when a later page fails', async () => {
  transport.queue(
    'promo.entityReport',
    promoRaw(Array(50).fill(entity()), 80),
    { success: false, errorCode: 54001, errorMsg: 'rate limited' },
  );
  const { data, meta } = await runProfit();
  assert.equal(meta.xhr_count, 4);
  assert.equal(data.items.some((item) => item.goods_id === '101'), true);
  assert.equal(data.summary.data_quality.promo_complete, false);
  assert.equal(data.summary.data_quality.promo_ratelimited, true);
  assert.equal(data.summary.promo_spend_yuan, null);
  assert.equal(data.summary.attributed_promo_spend_yuan, null);
});

it('treats PddCliError domain failures as an unavailable optional source', async () => {
  for (const [code, outcome] of [
    ['E_RATE_LIMIT', { success: false, errorCode: 54001, errorMsg: 'rate limited' }],
    ['E_NETWORK', { status: 500, raw: null }],
    ['E_BUSINESS', { success: false, errorCode: 40001, errorMsg: 'business error' }],
    ['E_AUTH_EXPIRED', { status: 401, raw: null }],
  ]) {
    const caseCtx = createTestCtx({
      accountId: activeAccount.id,
      account: activeAccount,
      mallId: '900001',
      limiter: createRateLimiter({ qps: 0 }),
      responses: {
        'orders.list': { success: true, result: { totalItemNum: 0, pageItems: [] } },
        'experiencePlan.orderInsuranceList': { success: true, errorCode: 0, result: { total: 0, orderInsurances: [] } },
        'promo.entityReport': outcome,
      },
    });
    const { data } = await runProfit(caseCtx);
    assert.equal(data.summary.data_quality.promo_complete, false);
    assert.equal(data.summary.promo_spend_yuan, null);
    assert.ok(data.hints.includes('推广数据拉取失败，相关推广花费和净利润为 null'));
    assert.equal(data.summary.data_quality.promo_ratelimited, code === 'E_RATE_LIMIT');
  }
});

it('handles a malformed entities response as an unavailable optional source', async () => {
  transport.set('promo.entityReport', promoRaw(null, 0));
  const { data } = await runProfit();
  assert.equal(data.summary.data_quality.promo_complete, false);
  assert.ok(data.hints.includes('推广数据拉取失败，相关推广花费和净利润为 null'));
});
