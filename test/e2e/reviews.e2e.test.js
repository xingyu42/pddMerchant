import { it } from 'vitest';
import assert from 'node:assert/strict';
import { runCli } from '../helpers/isolated-cli.js';
import { createReviewFixtures } from '../fixtures/test-data.js';

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
  for (const forbidden of ['13812345678', '13987654321', 'SYN-REVIEW-PRIVATE', 'avatar', 'orderSn',
    'orderId', 'specs', 'thumbUrl', 'goodsInfoUrl', 'orderSnapshotInfo', 'pictures', 'video']) {
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
  assert.deepEqual([view.total, view.items.length, view.truncated, view.window_days, view.goods_id, view.stars],
    [41, 41, false, 7, '101', [4, 5]]);
  assert.deepEqual(view.headline, ['近 7 天商品 101 的 4、5 星评价 41 条']);
  assert.equal(view.items[0].comment, '联系138****5678，描述不符');
  for (const forbidden of ['13812345678', '13987654321', 'SYN-REVIEW-PRIVATE']) {
    assert.equal(JSON.stringify(view).includes(forbidden), false, forbidden);
  }
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
