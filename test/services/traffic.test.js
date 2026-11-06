import { beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { PddCliError } from '../../src/infra/errors.js';

const mock = vi.hoisted(() => ({ calls: [], handler: null }));
vi.mock('../../src/adapter/run-endpoint.js', async (original) => ({ ...(await original()),
  async runEndpoint(_page, spec, params) {
    mock.calls.push({ name: spec.name, params });
    return spec.name === 'traffic.readyTime' ? '2024-03-01' : mock.handler(spec.name, params);
  },
}));
const { getTrafficView } = await import('../../src/services/traffic.js');
const { getGoodsTrafficView } = await import('../../src/services/goods-traffic.js');
const ctx = { page: {}, mallCtx: { activeId: '123' } };
const goods = { goodsId: '101', payOrdrCnt: 10, payOrdrAmt: 20 };
const promo = { goodsId: '101', directOrderNum: 2, indirectOrderNum: 1, directAmountFen: 123,
  indirectAmountFen: 50, spendFen: 10, click: 3 };

beforeEach(() => {
  mock.calls = [];
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-31T17:00:00Z'));
  mock.handler = (name) => {
    if (name === 'traffic.overviewList') return [{ statDate: '2024-03-01', uv: 1 }];
    if (name === 'traffic.goodsDetailList') return { total: 1, items: [goods] };
    return { items: [promo] };
  };
});

it('uses platform ready date including leap day for flow window', async () => {
  const view = await getTrafficView(ctx, { days: 3 });
  assert.deepEqual(view.window, { start_date: '2024-02-28', end_date: '2024-03-01', days: 3 });
  assert.deepEqual(mock.calls[1].params, { beginDate: '2024-02-28', endDate: '2024-03-01' });
  assert.equal(view.mall_id, '123');
});

it.each([0, 31, 1.5, '7', null])('rejects flow days %s before requests', async (days) => {
  await assert.rejects(getTrafficView(ctx, { days }), { code: 'E_USAGE', exitCode: 2 });
  assert.equal(mock.calls.length, 0);
});

it.each([14, 0, 31, '7', null])('rejects goods days %s before requests', async (days) => {
  await assert.rejects(getGoodsTrafficView(ctx, { days }), { code: 'E_USAGE', exitCode: 2 });
  assert.equal(mock.calls.length, 0);
});

it.each([[1, 0, '2024-03-01'], [7, 1, '2024-02-24'], [30, 2, '2024-02-01']])('uses native %s day query ending at platform ready date', async (days, type, start) => {
  const view = await getGoodsTrafficView(ctx, { days, goodsId: '101' });
  assert.deepEqual(view.window, { start_date: start, end_date: '2024-03-01', days });
  assert.equal(mock.calls[0].name, 'traffic.readyTime');
  assert.deepEqual(mock.calls[1].params, { startDate: start, endDate: '2024-03-01', queryType: type, page: 1, goodsId: '101' });
  assert.deepEqual(mock.calls.filter((call) => call.name === 'promo.goodsPromotionList').map((call) => call.params.scenesMode), [1, 3]);
  assert.equal(view.items[0].promo_direct_order_count, 4);
  assert.equal(view.items[0].non_promo_order_count, 6);
  assert.equal(view.items[0].promo_direct_amount_yuan, 2.46);
  assert.equal(view.items[0].non_promo_amount_yuan, 17.54);
});

it('distinguishes no campaigns, missing metrics, failure, and negative difference', async () => {
  mock.handler = (name) => name === 'traffic.goodsDetailList' ? { total: 1, items: [goods] } : { items: [] };
  assert.equal((await getGoodsTrafficView(ctx)).items[0].promo_direct_order_count, 0);
  mock.handler = (name) => name === 'traffic.goodsDetailList' ? { total: 1, items: [goods] } : { items: [{ ...promo, directOrderNum: null }] };
  assert.equal((await getGoodsTrafficView(ctx)).items[0].non_promo_order_count, null);
  mock.handler = (name) => {
    if (name === 'traffic.goodsDetailList') return { total: 1, items: [goods] };
    throw new PddCliError({ code: 'E_NETWORK', message: 'synthetic', exitCode: 5 });
  };
  const failed = await getGoodsTrafficView(ctx);
  assert.equal(failed.data_quality.promo_complete, false);
  assert.equal(failed.items[0].promo_direct_order_count, null);
  assert.equal(failed.items[0].non_promo_amount_yuan, null);
  mock.handler = (name) => name === 'traffic.goodsDetailList' ? { total: 1, items: [goods] }
    : { items: [{ ...promo, directOrderNum: 20, directAmountFen: 3000 }] };
  const negative = await getGoodsTrafficView(ctx);
  assert.equal(negative.items[0].non_promo_order_count, null);
  assert.equal(negative.items[0].non_promo_amount_yuan, null);
  assert.ok(negative.hints.some((hint) => hint.includes('负')));
});

it('surfaces unknown promo money units as a hint and null non-promo amount', async () => {
  mock.handler = (name) => name === 'traffic.goodsDetailList' ? { total: 1, items: [goods] }
    : { items: [{ ...promo, directAmountFen: null }], unknownUnits: ['WAN'] };
  const view = await getGoodsTrafficView(ctx);
  assert.equal(view.items[0].promo_direct_amount_yuan, null);
  assert.equal(view.items[0].non_promo_amount_yuan, null);
  assert.equal(view.items[0].non_promo_order_count, 6);
  assert.equal(view.hints.filter((hint) => hint.includes('单位未知')).length, 1);
});

it('caps goods and promo pagination, marks incomplete and does not reuse partial promo', async () => {
  mock.handler = (name) => name === 'traffic.goodsDetailList' ? { total: 1001, items: Array(50).fill(goods) }
    : { items: Array(50).fill(promo) };
  const result = await getGoodsTrafficView(ctx);
  assert.equal(result.data_quality.goods_truncated, true);
  assert.equal(result.data_quality.promo_complete, false);
  assert.equal(result.items[0].non_promo_order_count, null);
  assert.equal(mock.calls.filter((call) => call.name === 'traffic.goodsDetailList').length, 20);
});

it('only attributes promotion to the requested batch even if upstream ignores its search filter', async () => {
  mock.handler = (name, params) => {
    if (name === 'traffic.goodsDetailList') return { total: 51,
      items: Array.from({ length: params.page === 1 ? 50 : 1 }, (_unused, index) =>
        ({ ...goods, goodsId: String(101 + (params.page - 1) * 50 + index) })) };
    return { items: [promo, { ...promo, goodsId: '151' }] };
  };
  const view = await getGoodsTrafficView(ctx);
  assert.equal(view.items[0].promo_direct_order_count, 4);
  assert.equal(view.items[50].promo_direct_order_count, 4);
  assert.equal(view.data_quality.goods_truncated, false);
});

it('treats a successful empty goods list as complete', async () => {
  mock.handler = () => ({ total: 0, items: [] });
  const view = await getGoodsTrafficView(ctx);
  assert.equal(view.total, 0);
  assert.deepEqual(view.items, []);
  assert.equal(view.data_quality.goods_truncated, false);
});

it('keeps early empty-page collection visible as truncated', async () => {
  mock.handler = (name) => name === 'traffic.goodsDetailList' ? { total: 1, items: [] } : { items: [] };
  const view = await getGoodsTrafficView(ctx);
  assert.equal(view.data_quality.goods_truncated, true);
  assert.equal(view.total, 1);
  assert.ok(view.hints.some((hint) => hint.includes('提前空页')));
});

it('honors cancellation before any request', async () => {
  await assert.rejects(getGoodsTrafficView({ ...ctx, signal: AbortSignal.abort() }), { code: 'E_TIMEOUT' });
  assert.equal(mock.calls.length, 0);
});

it.each([new TypeError('bug'), new PddCliError({ code: 'E_TIMEOUT', message: 'timeout' })])('propagates unexpected errors and timeouts', async (error) => {
  mock.handler = (name) => { if (name === 'traffic.goodsDetailList') return { total: 1, items: [goods] }; throw error; };
  await assert.rejects(getGoodsTrafficView(ctx), (actual) => actual === error);
});

it.each(['abc', '0', '01', '1.5', 101])('rejects invalid goods id %s before requests', async (goodsId) => {
  await assert.rejects(getGoodsTrafficView(ctx, { goodsId }), { code: 'E_USAGE', exitCode: 2 });
  assert.equal(mock.calls.length, 0);
});
