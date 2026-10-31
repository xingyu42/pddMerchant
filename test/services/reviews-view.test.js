import { it } from 'vitest';
import assert from 'node:assert/strict';
import { toReviewsView, REVIEW_TAG_FIELDS, ISSUE_TYPE_FIELDS, NEGATIVE_REVIEW_FIELDS } from '../../src/services/views/reviews.js';

it('projects aggregates, keeps platform shares and masks phones in review and append text', () => {
  const view = toReviewsView({ keywords: { positiveKeywordList: [{ keywordName: '好', num: 2 }],
    negativeKeywordList: [{ keywordName: '描述不符', num: 1 }] },
  types: { typeList: [{ typeName: '商品质量', positive: 2, negative: 3, proportion: 44 }] },
  reviews: { total: 1, truncated: false, items: [{ goodsId: 101, createTime: 1793376000,
    score: 0, descScore: 3, logisticsScore: 2, serviceScore: 1, comment: '联系13812345678或13987654321',
    appendReview: '再联系13812345678', keywords: ['描述不符'], replied: true, pictureCount: 2,
    name: 'PRIVATE', avatar: 'PRIVATE', orderSn: 'PRIVATE', video: 'PRIVATE' }] } }, { days: 30, mallId: '900001' });
  assert.deepEqual(view.keyword_tags, { positive: [{ name: '好', count: 2 }], negative: [{ name: '描述不符', count: 1 }] });
  assert.deepEqual(view.issue_types, [{ name: '商品质量', positive_count: 2, negative_count: 3, share_pct: 44 }]);
  assert.deepEqual(view.negative_reviews.items[0], { goods_id: '101', reviewed_at: '2026-10-31 00:00:00',
    desc_score: 3, logistics_score: 2, service_score: 1, history_score: null,
    comment: '联系138****5678或139****4321', append_comment: '再联系138****5678', tags: ['描述不符'], replied: true, picture_count: 2 });
  assert.deepEqual(Object.keys(view.keyword_tags.positive[0]), REVIEW_TAG_FIELDS);
  assert.deepEqual(Object.keys(view.issue_types[0]), ISSUE_TYPE_FIELDS);
  assert.deepEqual(Object.keys(view.negative_reviews.items[0]), NEGATIVE_REVIEW_FIELDS);
  assert.deepEqual(view.headline, ['近 30 天中差评 1 条', '不满意标签前 3：描述不符(1)', '问题类型负面最多：商品质量']);
  assert.equal(JSON.stringify(view).includes('PRIVATE'), false);
});

it('uses historical scores exclusively and keeps missing values null', () => {
  const view = toReviewsView({ reviews: { total: 1, truncated: true, items: [{ score: 4,
    descScore: 2, logisticsScore: 3, serviceScore: 1 }] } }, { days: 60, hints: ['list_truncated'] });
  assert.deepEqual(view.negative_reviews.items[0], { goods_id: null, reviewed_at: null,
    desc_score: null, logistics_score: null, service_score: null, history_score: 4,
    comment: null, append_comment: null, tags: [], replied: null, picture_count: null });
  assert.equal(view.keyword_tags, null);
  assert.equal(view.issue_types, null);
  assert.deepEqual(view.headline, ['近 60 天中差评 1 条']);
  assert.equal(view.hints.length, 1);
  const missing = toReviewsView({}, { days: 30 });
  assert.equal(missing.negative_reviews, null);
  assert.deepEqual(missing.headline, ['近 30 天评价数据缺失']);
});
