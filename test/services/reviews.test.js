import { beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { PddCliError } from '../../src/infra/errors.js';
import { getReviewsView, getGoodsReviewsView } from '../../src/services/reviews.js';
import { createMemoryEndpointTransport, createTestCtx } from '../helpers/test-ctx.js';

const ok = (result) => ({ success: true, errorCode: 0, result });

let transport;
let ctx;
let listPages;
let goodsScorePages;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-31T00:00:00Z'));
  listPages = null;
  goodsScorePages = null;
  transport = createMemoryEndpointTransport({
    responses: {
      'reviews.keywordAgg': ok({ positiveKeywordList: [], negativeKeywordList: [] }),
      'reviews.typeAgg': ok({ typeList: [] }),
      'reviews.list': (params) => ok(listPages ? listPages(params.pageNo) : { data: [], totalRows: 0 }),
      'reviews.goodsScores': (params) => {
        if (goodsScorePages) {
          const paged = goodsScorePages(params.pageNo);
          return ok({ mallOprGoodsCntStd: paged.totalRows, goodsEvaluates: paged.data });
        }
        return ok({ mallOprGoodsCntStd: 0, goodsEvaluates: [] });
      },
    },
  });
  ctx = createTestCtx({ transport, mallId: '900001' });
});

it.each([[30, 1], [60, 5], [90, 4], [180, 3]])('maps %s days to rangeType %s and second timestamps', async (days, rangeType) => {
  const view = await getReviewsView(ctx, { days });
  const params = transport.calls[0].params;
  assert.equal(params.endTime, 1793404800);
  assert.equal(params.startTime, 1793404800 - days * 86400);
  assert.equal(params.rangeType, rangeType);
  assert.equal(view.mall_id, '900001');
});

it('defaults to thirty days', async () => {
  assert.equal((await getReviewsView(ctx)).window_days, 30);
});

it.each([45, 0, 31, 30.5, '30', null, NaN])('rejects invalid days %s', async (days) => {
  await assert.rejects(getReviewsView(ctx, { days }), { code: 'E_USAGE', exitCode: 2 });
  assert.deepEqual(transport.calls, []);
});

it('collects pages and preserves upstream totalRows', async () => {
  // 越过末页时上游 totalRows 回落为 0，总数取首页。
  listPages = (page) => ({ totalRows: page === 1 ? 81 : 0, data: Array.from({ length: page === 3 ? 1 : 40 },
    () => ({ goodsId: 101, score: 0, descScore: 3 })) });
  const view = await getReviewsView(ctx);
  assert.equal(view.negative_reviews.items.length, 81);
  assert.equal(view.negative_reviews.total, 81);
  assert.equal(view.negative_reviews.truncated, false);
  const listCalls = transport.calls.filter((call) => call.name === 'reviews.list');
  assert.deepEqual(listCalls.map((call) => call.params.pageNo), [1, 2, 3]);
  assert.deepEqual(listCalls[0].params.descScore, ['1', '2', '3']);
});

it('caps collection at the platform view limit and marks truncation', async () => {
  listPages = () => ({ totalRows: 2500, data: Array.from({ length: 40 }, () => ({ descScore: 1 })) });
  const view = await getReviewsView(ctx);
  assert.equal(view.negative_reviews.items.length, 2000);
  assert.equal(view.negative_reviews.total, 2500);
  assert.equal(view.negative_reviews.truncated, true);
  assert.equal(transport.calls.filter((call) => call.name === 'reviews.list').length, 50);
  assert.ok(view.hints.some((hint) => hint.includes('截断')));
});

it.each([['reviews.keywordAgg', 'keyword_tags'], ['reviews.typeAgg', 'issue_types'],
  ['reviews.list', 'negative_reviews']])('degrades independent %s failures', async (name, field) => {
  transport.set(name, { status: 500, raw: null });
  const view = await getReviewsView(ctx);
  assert.equal(view[field], null);
  assert.equal(view.hints.length, 1);
  assert.equal(transport.calls.length, 4);
});

it('throws the last typed error when all three sources fail', async () => {
  for (const name of ['reviews.keywordAgg', 'reviews.typeAgg', 'reviews.list']) {
    transport.fail(name, new PddCliError({ code: 'E_NETWORK', message: name, exitCode: 5 }));
  }
  await assert.rejects(getReviewsView(ctx), (error) => error === transport.errors['reviews.list']);
  assert.equal(transport.calls.some((call) => call.name === 'reviews.goodsScores'), false);
});

it('collects multi-page goods scores, caps at twenty pages and isolates failures across all days choices', async () => {
  const row = (id) => ({ goodsId: id, goodsName: `商品${id}`, goodsUnfkUndfltRevCnt1m: 1,
    avgDescRevScr1m: 5, avgLgstRevScr1m: 5, avgServRevScr1m: 5 });
  goodsScorePages = (page) => ({ totalRows: page === 1 ? 21 : 0,
    data: Array.from({ length: page === 3 ? 1 : 10 }, (_unused, index) => row((page - 1) * 10 + index + 1)) });
  const view = await getReviewsView(ctx);
  assert.deepEqual([view.goods_scores.items.length, view.goods_scores.total, view.goods_scores.truncated, view.goods_scores.window_days],
    [21, 21, false, 30]);
  assert.deepEqual(transport.calls.filter((call) => call.name === 'reviews.goodsScores').map((call) => call.params),
    [{ page: 1, pageNo: 1 }, { page: 2, pageNo: 2 }, { page: 3, pageNo: 3 }]);

  goodsScorePages = () => ({ totalRows: 205, data: Array.from({ length: 10 }, (_u, idx) => row(idx + 1)) });
  const capped = await getReviewsView(ctx);
  assert.deepEqual([capped.goods_scores.items.length, capped.goods_scores.total, capped.goods_scores.truncated], [200, 205, true]);
  assert.ok(capped.hints.includes('商品评分列表已达 200 个商品上限，结果已截断'));

  goodsScorePages = () => ({ totalRows: 200, data: Array.from({ length: 10 }, (_u, idx) => row(idx + 1)) });
  const exact = await getReviewsView(ctx);
  assert.deepEqual([exact.goods_scores.items.length, exact.goods_scores.total, exact.goods_scores.truncated, exact.hints],
    [200, 200, false, []]);

  goodsScorePages = null;
  transport.set('reviews.goodsScores', { status: 500, raw: null });
  const failed = await getReviewsView(ctx);
  assert.equal(failed.goods_scores, null);
  assert.deepEqual(failed.hints, ['商品评分拉取失败']);
  assert.notEqual(failed.negative_reviews, null);

  transport.set('reviews.goodsScores', ok({ mallOprGoodsCntStd: 1, goodsEvaluates: [row(1)] }));
  for (const days of [30, 60, 90, 180]) {
    transport.calls.length = 0;
    const res = await getReviewsView(ctx, { days });
    const scoreCall = transport.calls.find((call) => call.name === 'reviews.goodsScores');
    assert.deepEqual(scoreCall.params, { page: 1, pageNo: 1 });
    assert.equal(res.goods_scores.window_days, 30);
  }
});

it('stops without truncation when the list holds exactly the view limit', async () => {
  listPages = () => ({ totalRows: 2000, data: Array.from({ length: 40 }, () => ({ descScore: 1 })) });
  const view = await getGoodsReviewsView(ctx);
  assert.deepEqual([view.items.length, view.fetched_count, view.filtered_out_count, view.total, view.truncated, view.hints],
    [2000, 2000, 0, 2000, false, []]);
});

it('lists all stars shop-wide with substantive filtering by default, forwards filters, and supports all mode', async () => {
  listPages = () => ({
    totalRows: 2,
    data: [
      { goodsId: 101, descScore: 5, status: 4, comment: '该用户觉得商品很好，给出了5星好评' },
      { goodsId: 102, descScore: 5, status: 2, comment: '质量不错' },
    ],
  });
  const substantive = await getGoodsReviewsView(ctx);
  assert.deepEqual(transport.calls.map((call) => call.name), ['reviews.list']);
  const params = transport.calls[0].params;
  assert.deepEqual([params.endTime, params.startTime], [1793404800, 1793404800 - 30 * 86400]);
  assert.equal(Object.hasOwn(params, 'descScore') || Object.hasOwn(params, 'goodsId')
    || Object.hasOwn(params, 'mainReviewContentStatus') || Object.hasOwn(params, 'appendStatus'), false);
  assert.deepEqual([substantive.total, substantive.fetched_count, substantive.filtered_out_count,
    substantive.items.length, substantive.window_days, substantive.goods_id, substantive.stars, substantive.mall_id],
  [2, 2, 1, 1, 30, null, null, '900001']);
  assert.deepEqual(substantive.filter, { mode: '实质内容', min_length: 1 });
  assert.equal(substantive.items[0].goods_id, '102');

  const filtered = await getGoodsReviewsView(ctx, { days: 365, goodsId: '101', stars: ['4', '5'] });
  assert.deepEqual([transport.calls[1].params.goodsId, transport.calls[1].params.descScore], ['101', ['4', '5']]);
  assert.deepEqual([filtered.window_days, filtered.goods_id, filtered.stars], [365, '101', [4, 5]]);

  const full = await getGoodsReviewsView(ctx, { all: true });
  assert.deepEqual([full.total, full.fetched_count, full.filtered_out_count, full.items.length], [2, 2, 0, 2]);
  assert.deepEqual(full.filter, { mode: '全部', min_length: null });
  assert.deepEqual(full.headline, ['近 30 天全部星级评价 2 条']);
});

it('tracks fetched_count and filtered_out_count separately when hitting the 2000-row view limit', async () => {
  listPages = () => ({
    totalRows: 2500,
    data: Array.from({ length: 40 }, (_unused, index) => (index < 30
      ? { goodsId: 101, descScore: 5, status: 4, comment: '该用户觉得商品很好，给出了5星好评' }
      : { goodsId: 102, descScore: 5, status: 2, comment: '质量不错' })),
  });
  const view = await getGoodsReviewsView(ctx);
  assert.deepEqual([view.total, view.fetched_count, view.items.length, view.filtered_out_count, view.truncated],
    [2500, 2000, 500, 1500, true]);
  assert.deepEqual(view.headline, ['近 30 天全部星级评价 2500 条，实质内容 500 条', '已采集 2000 条，结果已截断']);
  assert.ok(view.hints.some((hint) => hint.includes('截断')));
});

it.each([0, 366, 1.5, '30'])('rejects goods review days %s before any request', async (days) => {
  await assert.rejects(getGoodsReviewsView(ctx, { days }), { code: 'E_USAGE', exitCode: 2 });
  assert.deepEqual(transport.calls, []);
});

it('supports minLength mode in getGoodsReviewsView without negative-review fallback', async () => {
  listPages = () => ({
    totalRows: 5,
    data: [
      { goodsId: 101, descScore: 5, status: 4, comment: '该用户觉得商品很好，给出了5星好评' },
      { goodsId: 102, descScore: 1, status: 4, comment: '该用户未填写文字评价' },
      { goodsId: 103, descScore: 2, status: 2, comment: '破了' },
      { goodsId: 104, descScore: 5, status: 2, comment: '质量很好不错' },
      { goodsId: 105, descScore: 5, status: 4, comment: '该用户觉得商品较好', appendReview: '追评很实用啊' },
    ],
  });
  const view = await getGoodsReviewsView(ctx, { minLength: 4 });
  assert.deepEqual(view.items.map((item) => item.goods_id), ['104', '105']);
  assert.deepEqual([view.total, view.fetched_count, view.filtered_out_count], [5, 5, 3]);
  assert.deepEqual(view.filter, { mode: '最小字数', min_length: 4 });
  assert.deepEqual(view.headline, ['近 30 天全部星级评价 5 条，有效字数 ≥ 4 字 2 条']);
});

it('propagates list failures for the goods review list', async () => {
  const err = new PddCliError({ code: 'E_NETWORK', message: 'fixture failure', exitCode: 5 });
  transport.fail('reviews.list', err);
  await assert.rejects(getGoodsReviewsView(ctx), (error) => error === err);
});
