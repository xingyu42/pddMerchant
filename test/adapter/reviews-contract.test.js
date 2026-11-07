import { it } from 'vitest';
import assert from 'node:assert/strict';
import { REVIEWS_LIST, REVIEWS_KEYWORD_AGG, REVIEWS_TYPE_AGG } from '../../src/adapter/endpoints/reviews.js';

it('sends exact signed POST payloads including string score filters and page size ten', () => {
  const params = { startTime: 100, endTime: 200, rangeType: 5, pageNo: 2, pageSize: 99, noise: 1 };
  for (const [spec, path] of [[REVIEWS_LIST, 'list'], [REVIEWS_KEYWORD_AGG, 'keywords/agg'],
    [REVIEWS_TYPE_AGG, 'type/agg']]) {
    assert.equal(spec.strategy, 'page-api');
    assert.equal(spec.nav.url, 'https://mms.pinduoduo.com/goods/evaluation/index');
    assert.equal(spec.apiUrl, `/saturn/reviews/${path}`);
  }
  assert.deepEqual(REVIEWS_LIST.buildPayload(params), { startTime: 100, endTime: 200,
    pageNo: 2, pageSize: 10, descScore: ['1', '2', '3'] });
  for (const spec of [REVIEWS_KEYWORD_AGG, REVIEWS_TYPE_AGG]) {
    assert.deepEqual(spec.buildPayload(params), { startTime: 100, endTime: 200, rangeType: 5 });
  }
});

it('whitelists nested review and aggregation fields, retaining only media counts and reply state', () => {
  const result = { totalRows: 1, data: [{ goodsId: 101, comment: '正文', appendReview: { comment: '追评', orderSn: 'PRIVATE' },
    keywords: [{ keywordName: '质量差', private: 'PRIVATE' }], pictures: ['PRIVATE'], reply: 'PRIVATE',
    name: 'PRIVATE', avatar: 'PRIVATE', orderId: 'PRIVATE', video: 'PRIVATE', score: 0 }] };
  assert.deepEqual(REVIEWS_LIST.normalize({ result }), { totalRows: 1, data: [{ goodsId: 101,
    comment: '正文', appendReview: '追评', keywords: ['质量差'], pictureCount: 1, replied: true, score: 0 }] });
  assert.deepEqual(REVIEWS_KEYWORD_AGG.normalize({ result: { positiveKeywordList: [{ keywordName: '好', num: 2, noise: 1 }],
    negativeKeywordList: [] } }), { positiveKeywordList: [{ keywordName: '好', num: 2 }], negativeKeywordList: [] });
  assert.deepEqual(REVIEWS_TYPE_AGG.normalize({ result: { typeList: [{ typeName: '质量', positive: 1,
    negative: 2, proportion: 50, noise: 1 }] } }), { typeList: [{ typeName: '质量', positive: 1, negative: 2, proportion: 50 }] });
});

it('rejects missing collections and totals while accepting explicit empty results', () => {
  for (const spec of [REVIEWS_LIST, REVIEWS_KEYWORD_AGG, REVIEWS_TYPE_AGG]) {
    assert.throws(() => spec.normalize({}), { code: 'E_NETWORK' });
  }
  assert.throws(() => REVIEWS_LIST.normalize({ result: { data: [] } }), { code: 'E_NETWORK' });
  assert.deepEqual(REVIEWS_LIST.normalize({ result: { totalRows: 0, data: [] } }), { totalRows: 0, data: [] });
});
