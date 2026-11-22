import { beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { PddCliError } from '../../src/infra/errors.js';

const fixtures = vi.hoisted(() => ({ calls: [], responses: {}, errors: {}, pages: null, goodsScorePages: null }));
vi.mock('../../src/adapter/run-endpoint.js', async (importOriginal) => ({ ...(await importOriginal()),
  async runEndpoint(_page, spec, params) {
    fixtures.calls.push({ name: spec.name, params });
    if (fixtures.errors[spec.name]) throw fixtures.errors[spec.name];
    if (spec.name === 'reviews.list' && fixtures.pages) return fixtures.pages(params.pageNo);
    if (spec.name === 'reviews.goodsScores' && fixtures.goodsScorePages) return fixtures.goodsScorePages(params.pageNo);
    return fixtures.responses[spec.name];
  },
}));
const { getReviewsView, getGoodsReviewsView } = await import('../../src/services/reviews.js');
const ctx = { page: {}, mallCtx: { activeId: '900001' } };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-31T00:00:00Z'));
  fixtures.calls = [];
  fixtures.errors = {};
  fixtures.pages = null;
  fixtures.goodsScorePages = null;
  fixtures.responses = { 'reviews.keywordAgg': { positiveKeywordList: [], negativeKeywordList: [] },
    'reviews.typeAgg': { typeList: [] }, 'reviews.list': { data: [], totalRows: 0 },
    'reviews.goodsScores': { data: [], totalRows: 0 } };
});

it.each([[30, 1], [60, 5], [90, 4], [180, 3]])('maps %s days to rangeType %s and second timestamps', async (days, rangeType) => {
  const view = await getReviewsView(ctx, { days });
  const params = fixtures.calls[0].params;
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
  assert.deepEqual(fixtures.calls, []);
});

it('collects pages and preserves upstream totalRows', async () => {
  // 越过末页时上游 totalRows 回落为 0，总数取首页。
  fixtures.pages = (page) => ({ totalRows: page === 1 ? 81 : 0, data: Array.from({ length: page === 3 ? 1 : 40 },
    () => ({ goodsId: 101, score: 0, descScore: 3 })) });
  const view = await getReviewsView(ctx);
  assert.equal(view.negative_reviews.items.length, 81);
  assert.equal(view.negative_reviews.total, 81);
  assert.equal(view.negative_reviews.truncated, false);
  const listCalls = fixtures.calls.filter((call) => call.name === 'reviews.list');
  assert.deepEqual(listCalls.map((call) => call.params.pageNo), [1, 2, 3]);
  assert.deepEqual(listCalls[0].params.descScore, ['1', '2', '3']);
});

it('caps collection at the platform view limit and marks truncation', async () => {
  fixtures.pages = () => ({ totalRows: 2500, data: Array.from({ length: 40 }, () => ({ descScore: 1 })) });
  const view = await getReviewsView(ctx);
  assert.equal(view.negative_reviews.items.length, 2000);
  assert.equal(view.negative_reviews.total, 2500);
  assert.equal(view.negative_reviews.truncated, true);
  assert.equal(fixtures.calls.filter((call) => call.name === 'reviews.list').length, 50);
  assert.ok(view.hints.some((hint) => hint.includes('截断')));
});

it.each([['reviews.keywordAgg', 'keyword_tags'], ['reviews.typeAgg', 'issue_types'],
  ['reviews.list', 'negative_reviews']])('degrades independent %s failures', async (name, field) => {
  fixtures.errors[name] = new PddCliError({ code: 'E_NETWORK', message: 'fixture failure', exitCode: 5 });
  const view = await getReviewsView(ctx);
  assert.equal(view[field], null);
  assert.equal(view.hints.length, 1);
  assert.equal(fixtures.calls.length, 4);
});

it('throws the last typed error when all three sources fail', async () => {
  for (const name of ['reviews.keywordAgg', 'reviews.typeAgg', 'reviews.list']) {
    fixtures.errors[name] = new PddCliError({ code: 'E_NETWORK', message: name, exitCode: 5 });
  }
  await assert.rejects(getReviewsView(ctx), (error) => error === fixtures.errors['reviews.list']);
  assert.equal(fixtures.calls.some((call) => call.name === 'reviews.goodsScores'), false);
});

it('collects multi-page goods scores, caps at twenty pages and isolates failures across all days choices', async () => {
  const row = (id) => ({ goodsId: id, goodsName: `商品${id}`, goodsUnfkUndfltRevCnt1m: 1,
    avgDescRevScr1m: 5, avgLgstRevScr1m: 5, avgServRevScr1m: 5 });
  fixtures.goodsScorePages = (page) => ({ totalRows: page === 1 ? 21 : 0,
    data: Array.from({ length: page === 3 ? 1 : 10 }, (_unused, index) => row((page - 1) * 10 + index + 1)) });
  const view = await getReviewsView(ctx);
  assert.deepEqual([view.goods_scores.items.length, view.goods_scores.total, view.goods_scores.truncated, view.goods_scores.window_days],
    [21, 21, false, 30]);
  assert.deepEqual(fixtures.calls.filter((call) => call.name === 'reviews.goodsScores').map((call) => call.params),
    [{ page: 1, pageNo: 1 }, { page: 2, pageNo: 2 }, { page: 3, pageNo: 3 }]);

  fixtures.goodsScorePages = () => ({ totalRows: 205, data: Array.from({ length: 10 }, (_u, idx) => row(idx + 1)) });
  const capped = await getReviewsView(ctx);
  assert.deepEqual([capped.goods_scores.items.length, capped.goods_scores.total, capped.goods_scores.truncated], [200, 205, true]);
  assert.ok(capped.hints.includes('商品评分列表已达 200 个商品上限，结果已截断'));

  fixtures.goodsScorePages = () => ({ totalRows: 200, data: Array.from({ length: 10 }, (_u, idx) => row(idx + 1)) });
  const exact = await getReviewsView(ctx);
  assert.deepEqual([exact.goods_scores.items.length, exact.goods_scores.total, exact.goods_scores.truncated, exact.hints],
    [200, 200, false, []]);

  fixtures.goodsScorePages = null;
  fixtures.errors['reviews.goodsScores'] = new PddCliError({ code: 'E_NETWORK', message: 'goods score down', exitCode: 5 });
  const failed = await getReviewsView(ctx);
  assert.equal(failed.goods_scores, null);
  assert.deepEqual(failed.hints, ['商品评分拉取失败']);
  assert.notEqual(failed.negative_reviews, null);

  fixtures.errors = {};
  fixtures.responses['reviews.goodsScores'] = { totalRows: 1, data: [row(1)] };
  for (const days of [30, 60, 90, 180]) {
    fixtures.calls = [];
    const res = await getReviewsView(ctx, { days });
    const scoreCall = fixtures.calls.find((call) => call.name === 'reviews.goodsScores');
    assert.deepEqual(scoreCall.params, { page: 1, pageNo: 1 });
    assert.equal(res.goods_scores.window_days, 30);
  }
});

it('stops without truncation when the list holds exactly the view limit', async () => {
  fixtures.pages = () => ({ totalRows: 2000, data: Array.from({ length: 40 }, () => ({ descScore: 1 })) });
  const view = await getGoodsReviewsView(ctx);
  assert.deepEqual([view.items.length, view.fetched_count, view.filtered_out_count, view.total, view.truncated, view.hints],
    [2000, 2000, 0, 2000, false, []]);
});

it('lists all stars shop-wide with substantive filtering by default, forwards filters, and supports all mode', async () => {
  fixtures.responses['reviews.list'] = {
    totalRows: 2,
    data: [
      { goodsId: 101, descScore: 5, status: 4, comment: '该用户觉得商品很好，给出了5星好评' },
      { goodsId: 102, descScore: 5, status: 2, comment: '质量不错' },
    ],
  };
  const substantive = await getGoodsReviewsView(ctx);
  assert.deepEqual(fixtures.calls.map((call) => call.name), ['reviews.list']);
  const params = fixtures.calls[0].params;
  assert.deepEqual([params.endTime, params.startTime], [1793404800, 1793404800 - 30 * 86400]);
  assert.equal(Object.hasOwn(params, 'descScore') || Object.hasOwn(params, 'goodsId')
    || Object.hasOwn(params, 'mainReviewContentStatus') || Object.hasOwn(params, 'appendStatus'), false);
  assert.deepEqual([substantive.total, substantive.fetched_count, substantive.filtered_out_count,
    substantive.items.length, substantive.window_days, substantive.goods_id, substantive.stars, substantive.mall_id],
  [2, 2, 1, 1, 30, null, null, '900001']);
  assert.deepEqual(substantive.filter, { mode: 'substantive', min_length: 1 });
  assert.equal(substantive.items[0].goods_id, '102');

  const filtered = await getGoodsReviewsView(ctx, { days: 365, goodsId: '101', stars: ['4', '5'] });
  assert.deepEqual([fixtures.calls[1].params.goodsId, fixtures.calls[1].params.descScore], ['101', ['4', '5']]);
  assert.deepEqual([filtered.window_days, filtered.goods_id, filtered.stars], [365, '101', [4, 5]]);

  const full = await getGoodsReviewsView(ctx, { all: true });
  assert.deepEqual([full.total, full.fetched_count, full.filtered_out_count, full.items.length], [2, 2, 0, 2]);
  assert.deepEqual(full.filter, { mode: 'all', min_length: null });
  assert.deepEqual(full.headline, ['近 30 天全部星级评价 2 条']);
});

it('tracks fetched_count and filtered_out_count separately when hitting the 2000-row view limit', async () => {
  fixtures.pages = () => ({
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
  assert.deepEqual(fixtures.calls, []);
});

it('propagates list failures for the goods review list', async () => {
  fixtures.errors['reviews.list'] = new PddCliError({ code: 'E_NETWORK', message: 'fixture failure', exitCode: 5 });
  await assert.rejects(getGoodsReviewsView(ctx), (error) => error === fixtures.errors['reviews.list']);
});
