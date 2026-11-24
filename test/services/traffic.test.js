import { beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { PddCliError } from '../../src/infra/errors.js';
import { getTrafficView } from '../../src/services/traffic.js';
import { getGoodsTrafficView } from '../../src/services/goods-traffic.js';
import { createMemoryEndpointTransport, createTestCtx } from '../helpers/test-ctx.js';

const ok = (result) => ({ success: true, errorCode: 0, result });
const goods = { goodsId: '101', payOrdrCnt: 10, payOrdrAmt: 20 };
const promo = {
  goodsId: '101',
  directOrderNum: 2,
  indirectOrderNum: 1,
  directGmv: { value: 123, unit: 'FEN' },
  indirectPayGmv: { value: 50, unit: 'FEN' },
  spend: { value: 10, unit: 'FEN' },
  click: 3,
};
const validGoodsTodayOverview = {
  guvRt: '10',
  gpvRt: '20',
  vstGoodsCntRt: '1',
  payOrdrCntRt: '2',
  payOrdrAmtRt: '25.50',
  payUvRtoRt: '20%',
};

let transport;
let ctx;

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-31T17:00:00Z'));
  transport = createMemoryEndpointTransport((spec) => {
    if (spec.name === 'traffic.readyTime') return ok('2024-03-01');
    if (spec.name === 'traffic.overviewList') return ok([{ statDate: '2024-03-01', uv: 1 }]);
    if (spec.name === 'traffic.todayFlow') return ok({ muvRt: 1 });
    if (spec.name === 'traffic.todayTrade') return ok({ todayRtList: [] });
    if (spec.name === 'traffic.goodsDetailList') return ok({ totalNum: 1, goodsDetailList: [goods] });
    if (spec.name === 'traffic.goodsTodayOverview') return ok(validGoodsTodayOverview);
    if (spec.name === 'traffic.goodsTodayStat') {
      return ok({
        todayGoodsDetail: { goodsUv: 10, payOrdrCnt: 2, payOrdrAmt: 25.5 },
        todayGoodsDetailList: [{ statHr: '01', goodsUv: 10, payOrdrCnt: 2, payOrdrAmt: 25.5 }],
      });
    }
    return ok({ adInfos: [promo] });
  });
  ctx = createTestCtx({ transport, mallId: '123' });
});

it('uses platform ready date including leap day for flow window', async () => {
  const view = await getTrafficView(ctx, { days: 3 });
  assert.deepEqual(view.window, { start_date: '2024-02-28', end_date: '2024-03-01', days: 3 });
  assert.deepEqual(transport.calls[1].params, { beginDate: '2024-02-28', endDate: '2024-03-01' });
  assert.equal(view.mall_id, '123');
});

it.each([0, 31, 1.5, '7', null])('rejects flow days %s before requests', async (days) => {
  await assert.rejects(getTrafficView(ctx, { days }), { code: 'E_USAGE', exitCode: 2 });
  assert.equal(transport.calls.length, 0);
});

it.each([14, 0, 31, '7', null])('rejects goods days %s before requests', async (days) => {
  await assert.rejects(getGoodsTrafficView(ctx, { days }), { code: 'E_USAGE', exitCode: 2 });
  assert.equal(transport.calls.length, 0);
});

it.each([[1, 0, '2024-03-01'], [7, 1, '2024-02-24'], [30, 2, '2024-02-01']])('uses native %s day query ending at platform ready date', async (days, type, start) => {
  const { data: view } = await getGoodsTrafficView(ctx, { days, goodsId: '101' });
  assert.deepEqual(view.window, { start_date: start, end_date: '2024-03-01', days });
  assert.equal(transport.calls[0].name, 'traffic.readyTime');
  assert.deepEqual(transport.calls[1].params, { startDate: start, endDate: '2024-03-01', queryType: type, page: 1, goodsId: '101' });
  assert.deepEqual(transport.calls.filter((call) => call.name === 'promo.goodsPromotionList').map((call) => call.params.scenesMode), [1, 3]);
  assert.equal(transport.calls.some((call) => call.name === 'traffic.goodsTodayStat' && call.params.goodsId === '101'), true);
  assert.equal(transport.calls.some((call) => call.name === 'traffic.goodsTodayOverview'), false);
  assert.equal(view.items[0].promo_direct_order_count, 4);
  assert.equal(view.items[0].non_promo_order_count, 6);
  assert.equal(view.items[0].promo_direct_amount_yuan, 2.46);
  assert.equal(view.items[0].non_promo_amount_yuan, 17.54);
  assert.equal(view.today.as_of_hour, '01');
});

it('distinguishes no campaigns, missing metrics, failure, and negative difference', async () => {
  transport.setHandler((spec) => {
    if (spec.name === 'traffic.readyTime') return ok('2024-03-01');
    if (spec.name === 'traffic.goodsDetailList') return ok({ totalNum: 1, goodsDetailList: [goods] });
    if (spec.name === 'traffic.goodsTodayOverview') return ok(validGoodsTodayOverview);
    return ok({ adInfos: [] });
  });
  assert.equal((await getGoodsTrafficView(ctx)).data.items[0].promo_direct_order_count, 0);

  transport.setHandler((spec) => {
    if (spec.name === 'traffic.readyTime') return ok('2024-03-01');
    if (spec.name === 'traffic.goodsDetailList') return ok({ totalNum: 1, goodsDetailList: [goods] });
    if (spec.name === 'traffic.goodsTodayOverview') return ok(validGoodsTodayOverview);
    return ok({ adInfos: [{ ...promo, directOrderNum: null }] });
  });
  assert.equal((await getGoodsTrafficView(ctx)).data.items[0].non_promo_order_count, null);

  transport.setHandler((spec) => {
    if (spec.name === 'traffic.readyTime') return ok('2024-03-01');
    if (spec.name === 'traffic.goodsDetailList') return ok({ totalNum: 1, goodsDetailList: [goods] });
    if (spec.name === 'traffic.goodsTodayOverview') return ok(validGoodsTodayOverview);
    return { status: 500, raw: null };
  });
  const { data: failed } = await getGoodsTrafficView(ctx);
  assert.equal(failed.data_quality.promo_complete, false);
  assert.equal(failed.items[0].promo_direct_order_count, null);
  assert.equal(failed.items[0].non_promo_amount_yuan, null);

  transport.setHandler((spec) => {
    if (spec.name === 'traffic.readyTime') return ok('2024-03-01');
    if (spec.name === 'traffic.goodsDetailList') return ok({ totalNum: 1, goodsDetailList: [goods] });
    if (spec.name === 'traffic.goodsTodayOverview') return ok(validGoodsTodayOverview);
    return ok({ adInfos: [{ ...promo, directOrderNum: 20, directGmv: { value: 3000, unit: 'FEN' } }] });
  });
  const { data: negative } = await getGoodsTrafficView(ctx);
  assert.equal(negative.items[0].non_promo_order_count, null);
  assert.equal(negative.items[0].non_promo_amount_yuan, null);
  assert.ok(negative.hints.some((hint) => hint.includes('负')));
});

it('surfaces unknown promo money units as a hint and null non-promo amount', async () => {
  transport.setHandler((spec) => {
    if (spec.name === 'traffic.readyTime') return ok('2024-03-01');
    if (spec.name === 'traffic.goodsDetailList') return ok({ totalNum: 1, goodsDetailList: [goods] });
    if (spec.name === 'traffic.goodsTodayOverview') return ok(validGoodsTodayOverview);
    return ok({ adInfos: [{ ...promo, directGmv: { value: 1, unit: 'WAN' } }] });
  });
  const { data: view } = await getGoodsTrafficView(ctx);
  assert.equal(view.items[0].promo_direct_amount_yuan, null);
  assert.equal(view.items[0].non_promo_amount_yuan, null);
  assert.equal(view.items[0].non_promo_order_count, 6);
  assert.equal(view.hints.filter((hint) => hint.includes('单位未知')).length, 1);
});

it('caps goods and promo pagination, marks incomplete and does not reuse partial promo', async () => {
  transport.setHandler((spec) => {
    if (spec.name === 'traffic.readyTime') return ok('2024-03-01');
    if (spec.name === 'traffic.goodsDetailList') return ok({ totalNum: 1001, goodsDetailList: Array(50).fill(goods) });
    if (spec.name === 'traffic.goodsTodayOverview') return ok(validGoodsTodayOverview);
    return ok({ adInfos: Array(50).fill(promo) });
  });
  const { data: result } = await getGoodsTrafficView(ctx);
  assert.equal(result.data_quality.goods_truncated, true);
  assert.equal(result.data_quality.promo_complete, false);
  assert.equal(result.items[0].non_promo_order_count, null);
  assert.equal(transport.calls.filter((call) => call.name === 'traffic.goodsDetailList').length, 20);
});

it('only attributes promotion to the requested batch even if upstream ignores its search filter', async () => {
  transport.setHandler((spec, params) => {
    if (spec.name === 'traffic.readyTime') return ok('2024-03-01');
    if (spec.name === 'traffic.goodsDetailList') {
      return ok({
        totalNum: 51,
        goodsDetailList: Array.from({ length: params.page === 1 ? 50 : 1 }, (_unused, index) =>
          ({ ...goods, goodsId: String(101 + (params.page - 1) * 50 + index) })),
      });
    }
    if (spec.name === 'traffic.goodsTodayOverview') return ok(validGoodsTodayOverview);
    return ok({ adInfos: [promo, { ...promo, goodsId: '151' }] });
  });
  const { data: view } = await getGoodsTrafficView(ctx);
  assert.equal(view.items[0].promo_direct_order_count, 4);
  assert.equal(view.items[50].promo_direct_order_count, 4);
  assert.equal(view.data_quality.goods_truncated, false);
});

it('treats a successful empty goods list as complete', async () => {
  transport.setHandler((spec) => {
    if (spec.name === 'traffic.readyTime') return ok('2024-03-01');
    if (spec.name === 'traffic.goodsTodayOverview') return ok(validGoodsTodayOverview);
    if (spec.name === 'traffic.goodsDetailList') return ok({ totalNum: 0, goodsDetailList: [] });
    return ok({ adInfos: [] });
  });
  const { data: view } = await getGoodsTrafficView(ctx);
  assert.equal(view.total, 0);
  assert.deepEqual(view.items, []);
  assert.equal(view.data_quality.goods_truncated, false);
});

it('keeps early empty-page collection visible as truncated', async () => {
  transport.setHandler((spec) => {
    if (spec.name === 'traffic.readyTime') return ok('2024-03-01');
    if (spec.name === 'traffic.goodsDetailList') return ok({ totalNum: 1, goodsDetailList: [] });
    if (spec.name === 'traffic.goodsTodayOverview') return ok(validGoodsTodayOverview);
    return ok({ adInfos: [] });
  });
  const { data: view } = await getGoodsTrafficView(ctx);
  assert.equal(view.data_quality.goods_truncated, true);
  assert.equal(view.total, 1);
  assert.ok(view.hints.some((hint) => hint.includes('提前空页')));
});

it('degrades goods today business/network failures to null while propagating timeouts and bugs', async () => {
  transport.setHandler((spec) => {
    if (spec.name === 'traffic.readyTime') return ok('2024-03-01');
    if (spec.name === 'traffic.goodsDetailList') return ok({ totalNum: 1, goodsDetailList: [goods] });
    if (spec.name === 'promo.goodsPromotionList') return ok({ adInfos: [promo] });
    if (spec.name === 'traffic.goodsTodayOverview') return { success: false, errorCode: 40001, errorMsg: 'pua' };
    return ok({});
  });
  const { data: degraded } = await getGoodsTrafficView(ctx);
  assert.equal(degraded.today, null);
  assert.ok(degraded.hints.some((hint) => hint.includes('今日实时数据拉取失败')));
  assert.equal(degraded.items.length, 1);

  const timeout = new PddCliError({ code: 'E_TIMEOUT', message: 'timeout', exitCode: 5 });
  transport.setHandler((spec) => {
    if (spec.name === 'traffic.readyTime') return ok('2024-03-01');
    if (spec.name === 'traffic.goodsDetailList') return ok({ totalNum: 1, goodsDetailList: [goods] });
    if (spec.name === 'promo.goodsPromotionList') return ok({ adInfos: [promo] });
    throw timeout;
  });
  await assert.rejects(getGoodsTrafficView(ctx, { goodsId: '101' }), (err) => err === timeout);
});

it.each(['abc', '0', '01', '1.5', 101])('rejects invalid goods id %s before requests', async (goodsId) => {
  await assert.rejects(getGoodsTrafficView(ctx, { goodsId }), { code: 'E_USAGE', exitCode: 2 });
  assert.equal(transport.calls.length, 0);
});
