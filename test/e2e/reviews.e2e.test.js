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
  assert.equal(view.negative_reviews.total, 11);
  assert.equal(view.negative_reviews.items.length, 11);
  assert.equal(view.negative_reviews.truncated, false);
  assert.equal(view.negative_reviews.items[10].goods_id, '111');
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

it('marks thirty-page collection truncated', () => {
  const { envelope } = runCli(['diagnose', 'reviews'], { fixtures: createReviewFixtures({ count: 305 }) });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.negative_reviews.items.length, 300);
  assert.equal(envelope.data.negative_reviews.items[299].goods_id, '400');
  assert.equal(envelope.data.negative_reviews.total, 305);
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
