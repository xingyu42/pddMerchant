import { it } from 'vitest';
import assert from 'node:assert/strict';
import { runCli } from '../helpers/isolated-cli.js';
import { createReviewFixtures, createGoodsReviewFilterFixtures } from '../fixtures/test-data.js';
import { REVIEW_FIELDS } from '../../src/services/views/reviews.js';

it('collects two pages, platform tags and five issue types while excluding private fields', () => {
  const result = runCli(['diagnose', 'reviews'], { fixtures: createReviewFixtures() });
  assert.equal(result.status, 0);
  assert.equal(result.envelope.command, 'diagnose.reviews');
  const view = result.envelope.data;
  assert.deepEqual(view.keyword_tags, { positive: [{ name: '做工好', count: 4 }], negative: [{ name: '描述不符', count: 2 }] });
  assert.equal(view.issue_types.length, 5);
  assert.equal(view.issue_types[0].share_pct, 44);
  assert.equal(view.negative_reviews.total, 41);
  assert.equal(view.negative_reviews.items.length, 41);
  assert.equal(view.negative_reviews.truncated, false);
  assert.equal(view.negative_reviews.items[40].goods_id, '141');
  assert.equal(view.negative_reviews.items[0].comment, '联系138****5678，描述不符');
  assert.equal(view.negative_reviews.items[0].append_comment, '追评139****4321');
  assert.equal(view.negative_reviews.items[0].picture_count, 2);
  assert.equal(view.negative_reviews.items[1].history_score, 3);
  assert.equal(view.negative_reviews.items[1].desc_score, null);
  assert.deepEqual(view.goods_scores, {
    caliber: '数据中心-评价数据',
    window_days: 30,
    total: 2,
    truncated: false,
    items: [
      { goods_id: '201', goods_name: '合成商品1', review_count: 38,
        desc_score_avg: 4.89, logistics_score_avg: 4.76, service_score_avg: 4.91 },
      { goods_id: '202', goods_name: '零评价商品', review_count: 0,
        desc_score_avg: null, logistics_score_avg: null, service_score_avg: null },
    ],
  });
  assert.ok(view.headline.includes('近 30 日有效评价商品 1 个'));
  for (const forbidden of ['13812345678', '13987654321', 'SYN-REVIEW-PRIVATE', 'avatar', 'orderSn',
    'orderId', 'specs', 'thumbUrl', 'goodsInfoUrl', 'orderSnapshotInfo', 'pictures', 'video',
    'todayEvaluationCount', 'avgDescRank', 'avgLgstRank', 'avgServRank', 'starless4OrdrDfltRevCnt1m',
    'avgUapplDescRevScr1m', 'avgAntiDescCtgrpRevScrPct1m', 'hdThumbUrl', 'SYN-GOODS-THUMB', 'goodsStatus']) {
    assert.equal(JSON.stringify(view).includes(forbidden), false, forbidden);
  }
  for (const review of view.negative_reviews.items) assert.equal(Object.hasOwn(review, 'name'), false);
});

it('lists goods reviews across pages with filters echoed and private fields excluded', () => {
  const result = runCli(['goods', 'reviews', '--days', '7', '--goods-id', '101', '--stars', '5,4,5'],
    { fixtures: createReviewFixtures() });
  assert.equal(result.status, 0);
  assert.equal(result.envelope.command, 'goods.reviews');
  const view = result.envelope.data;
  assert.deepEqual([view.total, view.fetched_count, view.filtered_out_count, view.items.length,
    view.truncated, view.window_days, view.goods_id, view.stars],
  [41, 41, 0, 41, false, 7, '101', [4, 5]]);
  assert.deepEqual(view.filter, { mode: 'substantive', min_length: 1 });
  assert.deepEqual(view.headline, ['近 7 天商品 101 的 4、5 星评价 41 条，实质内容 41 条']);
  assert.equal(view.items[0].comment, '联系138****5678，描述不符');
  for (const forbidden of ['13812345678', '13987654321', 'SYN-REVIEW-PRIVATE']) {
    assert.equal(JSON.stringify(view).includes(forbidden), false, forbidden);
  }
});

it('filters placeholders and non-substantive 4-5 star reviews by default, restores all with --all, and leaves diagnose reviews untouched', () => {
  const { fixtures, keptIds, totalCount } = createGoodsReviewFilterFixtures();

  const defaultRes = runCli(['goods', 'reviews'], { fixtures });
  assert.equal(defaultRes.status, 0);
  const view = defaultRes.envelope.data;
  assert.deepEqual(view.items.map((item) => item.goods_id), keptIds);
  assert.deepEqual([view.total, view.fetched_count, view.filtered_out_count],
    [totalCount, totalCount, totalCount - keptIds.length]);
  assert.deepEqual(view.filter, { mode: 'substantive', min_length: 1 });
  assert.deepEqual(view.headline, [`近 30 天全部星级评价 ${totalCount} 条，实质内容 ${keptIds.length} 条`]);
  assert.equal(view.items.find((item) => item.goods_id === '2006').append_comment, '追评字符串139****4321有划痕');
  assert.equal(view.items.find((item) => item.goods_id === '2007').append_comment, '追评对象138****5678少配件');
  assert.equal(view.items.find((item) => item.goods_id === '2008').comment, '该用户未填写文字评价');
  assert.equal(view.items.find((item) => item.goods_id === '2009').comment, '联系138****5678处理');
  assert.deepEqual([
    view.items.find((item) => item.goods_id === '2010').history_score,
    view.items.find((item) => item.goods_id === '2010').desc_score,
  ], [3, null]);
  for (const item of view.items) {
    assert.deepEqual(Object.keys(item), REVIEW_FIELDS);
    assert.equal(Object.hasOwn(item, 'status'), false);
  }
  for (const forbidden of ['13812345678', '13987654321', 'SYN-REVIEW-PRIVATE']) {
    assert.equal(JSON.stringify(view).includes(forbidden), false, forbidden);
  }

  const allRes = runCli(['goods', 'reviews', '--all'], { fixtures });
  assert.equal(allRes.status, 0);
  const allView = allRes.envelope.data;
  assert.deepEqual([allView.total, allView.fetched_count, allView.filtered_out_count, allView.items.length],
    [totalCount, totalCount, 0, totalCount]);
  assert.deepEqual(allView.filter, { mode: 'all', min_length: null });
  assert.deepEqual(allView.headline, [`近 30 天全部星级评价 ${totalCount} 条`]);
  for (const item of allView.items) assert.equal(Object.hasOwn(item, 'status'), false);

  const diagnoseRes = runCli(['diagnose', 'reviews'], { fixtures });
  assert.equal(diagnoseRes.status, 0);
  const diag = diagnoseRes.envelope.data;
  assert.equal(diag.negative_reviews.items.length, totalCount);
  assert.equal(Object.hasOwn(diag, 'filter'), false);
  assert.equal(Object.hasOwn(diag, 'fetched_count'), false);
  assert.equal(Object.hasOwn(diag, 'filtered_out_count'), false);
});

it('reports pre-filter fetched_count on 2000-row truncation while accounting filtered_out_count', () => {
  const reviews = Array.from({ length: 2000 }, (_unused, index) => (index < 1500
    ? { goodsId: 1000 + index, createTime: 1793376000, score: 0, descScore: 5, status: 4, comment: '该用户觉得商品很好，给出了5星好评' }
    : { goodsId: 3000 + index, createTime: 1793376000, score: 0, descScore: 5, status: 2, comment: '质量不错' }));
  const fixtures = createReviewFixtures({ reviews, totalRows: 2050 });
  const { status, envelope } = runCli(['goods', 'reviews'], { fixtures });
  assert.equal(status, 0);
  const view = envelope.data;
  assert.deepEqual([view.total, view.fetched_count, view.items.length, view.filtered_out_count, view.truncated],
    [2050, 2000, 500, 1500, true]);
  assert.equal(view.items.length + view.filtered_out_count, 2000);
  assert.deepEqual(view.headline, ['近 30 天全部星级评价 2050 条，实质内容 500 条', '已采集 2000 条，结果已截断']);
  assert.ok(view.hints.some((hint) => hint.includes('截断')));
});

it.each([['--days', '0'], ['--days', '366'], ['--goods-id', 'abc'], ['--stars', '6'], ['--stars', '1,,2']])(
  'rejects goods reviews %s %s with exit two', (flag, value) => {
    const result = runCli(['goods', 'reviews', flag, value], { fixtures: createReviewFixtures() });
    assert.equal(result.status, 2);
    assert.equal(result.envelope.error.code, 'E_USAGE');
    assert.equal(result.envelope.command, 'goods.reviews');
    assert.equal(result.envelope.meta.xhr_count ?? 0, 0);
  });

it('marks collection truncated at the platform view limit', () => {
  const { envelope } = runCli(['diagnose', 'reviews'], { fixtures: createReviewFixtures({ count: 2005 }) });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.negative_reviews.items.length, 2000);
  assert.equal(envelope.data.negative_reviews.items[1999].goods_id, '2100');
  assert.equal(envelope.data.negative_reviews.total, 2005);
  assert.equal(envelope.data.negative_reviews.truncated, true);
  assert.ok(envelope.data.hints.some((hint) => hint.includes('截断')));
});

it.each([30, 60, 90, 180])('accepts days %s', (days) => {
  const result = runCli(['diagnose', 'reviews', '--days', String(days)], { fixtures: createReviewFixtures() });
  assert.equal(result.status, 0);
  assert.equal(result.envelope.data.window_days, days);
  assert.equal(result.envelope.data.goods_scores.window_days, 30);
  assert.equal(result.envelope.data.goods_scores.items.length, 2);
  assert.equal(result.envelope.data.goods_scores.items[0].goods_id, '201');
});

it('caps goods scores at two hundred items with a truncation hint', () => {
  const { status, envelope } = runCli(['diagnose', 'reviews'], { fixtures: createReviewFixtures({ goodsScoresCount: 205 }) });
  assert.equal(status, 0);
  assert.equal(envelope.data.goods_scores.items.length, 200);
  assert.equal(envelope.data.goods_scores.total, 205);
  assert.equal(envelope.data.goods_scores.truncated, true);
  assert.ok(envelope.data.hints.includes('商品评分列表已达 200 个商品上限，结果已截断'));
});

it('degrades goods scores failure without failing the report', () => {
  const fixtures = { ...createReviewFixtures(), 'endpoints/reviews.goodsScores.json': {
    __throws: true, __error: { code: 'E_NETWORK', message: 'goods score unavailable', exitCode: 5 },
  } };
  const result = runCli(['diagnose', 'reviews'], { fixtures });
  assert.equal(result.status, 0);
  assert.equal(result.envelope.ok, true);
  assert.equal(result.envelope.data.goods_scores, null);
  assert.deepEqual(result.envelope.data.hints, ['商品评分拉取失败']);
  assert.equal(result.envelope.data.headline.some((line) => line.includes('近 30 日有效评价商品')), false);
  assert.notEqual(result.envelope.data.keyword_tags, null);
  assert.notEqual(result.envelope.data.issue_types, null);
  assert.notEqual(result.envelope.data.negative_reviews, null);
});

it('rejects forty-five days with exit two', () => {
  const result = runCli(['diagnose', 'reviews', '--days', '45'], { fixtures: createReviewFixtures() });
  assert.equal(result.status, 2);
  assert.equal(result.envelope.error.code, 'E_USAGE');
});

it.each([['keywordAgg', 'keyword_tags'], ['typeAgg', 'issue_types'], ['list', 'negative_reviews']])(
  'degrades the independent %s source', (name, field) => {
    const fixtures = { ...createReviewFixtures(), [`endpoints/reviews.${name}.json`]: {
      __throws: true, __error: { code: 'E_NETWORK', message: 'fixture unavailable', exitCode: 5 },
    } };
    const { envelope } = runCli(['diagnose', 'reviews'], { fixtures });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data[field], null);
    assert.equal(envelope.data.hints.length, 1);
  });

it('keeps satisfied tags when the platform returns a null dissatisfied list', () => {
  const fixtures = { ...createReviewFixtures(), 'endpoints/reviews.keywordAgg.json': { success: true, errorCode: 1000000,
    result: { positiveKeywordList: [{ keywordName: '做工好', num: 4 }], negativeKeywordList: null } } };
  const { envelope } = runCli(['diagnose', 'reviews'], { fixtures });
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.data.keyword_tags, { positive: [{ name: '做工好', count: 4 }], negative: [] });
  assert.deepEqual(envelope.data.hints, []);
  assert.equal(envelope.data.headline.some((line) => line.includes('不满意标签')), false);
});

it('fails with the last error when all sources fail', () => {
  const fixtures = createReviewFixtures();
  for (const name of ['keywordAgg', 'typeAgg', 'list']) {
    fixtures[`endpoints/reviews.${name}.json`] = { __throws: true,
      __error: { code: 'E_BUSINESS', message: `fixture ${name}`, exitCode: 6 } };
  }
  const result = runCli(['diagnose', 'reviews'], { fixtures });
  assert.equal(result.status, 6);
  assert.equal(result.envelope.data, null);
  assert.equal(result.envelope.error.message, 'fixture list');
});
