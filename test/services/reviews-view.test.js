import { it } from 'vitest';
import assert from 'node:assert/strict';
import { toReviewsView, toGoodsReviewsView, REVIEW_TAG_FIELDS, ISSUE_TYPE_FIELDS, REVIEW_FIELDS } from '../../src/services/views/reviews.js';

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
  assert.deepEqual(Object.keys(view.negative_reviews.items[0]), REVIEW_FIELDS);
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

// 真实账号实测：没有中差评的店铺各问题类型负面数全为 0，不满意标签为空。
it('omits the top negative issue line when every issue type has zero negatives', () => {
  const keywords = { positiveKeywordList: [{ keywordName: '质量好', num: 9 }], negativeKeywordList: [] };
  const types = { typeList: [{ typeName: '商品质量', positive: 17, negative: 0, proportion: 50 },
    { typeName: '商品描述', positive: 12, negative: 0, proportion: 35 }] };
  const reviews = { total: 0, truncated: false, items: [] };
  assert.deepEqual(toReviewsView({ keywords, types, reviews }, { days: 30 }).headline, ['近 30 天中差评 0 条']);
  const mixed = { typeList: [{ typeName: '商品质量', positive: 1, negative: 0, proportion: 50 },
    { typeName: '物流问题', positive: 0, negative: 2, proportion: 50 }] };
  assert.deepEqual(toReviewsView({ types: mixed, reviews }, { days: 30 }).headline,
    ['近 30 天中差评 0 条', '问题类型负面最多：物流问题']);
  // 列表拉取失败时，已取到的聚合仍如实陈述，不落到「数据缺失」。
  assert.deepEqual(toReviewsView({ types }, { days: 30 }).headline, ['近 30 天各问题类型负面数均为 0']);
  assert.deepEqual(toReviewsView({ keywords }, { days: 90 }).headline, ['近 90 天不满意标签 0 个']);
  assert.deepEqual(toReviewsView({ keywords, types }, { days: 30 }).headline,
    ['近 30 天不满意标签 0 个，各问题类型负面数均为 0']);
  const unknown = { typeList: [{ typeName: '商品质量', positive: 1, negative: null, proportion: 50 }] };
  assert.deepEqual(toReviewsView({ types: unknown }, { days: 30 }).headline, ['近 30 天评价数据缺失']);
});

it('projects the goods review list with scope, stars and truncation headlines', () => {
  const reviews = { total: 2100, truncated: true,
    items: [{ goodsId: 101, descScore: 5, comment: '联系13812345678', name: 'PRIVATE' }] };
  const view = toGoodsReviewsView(reviews, { days: 7, goodsId: '101', stars: ['4', '5'],
    hints: ['list_truncated'], mallId: '900001' });
  assert.deepEqual(view.headline, ['近 7 天商品 101 的 4、5 星评价 2100 条', '已采集 1 条，结果已截断']);
  assert.deepEqual(Object.keys(view.items[0]), REVIEW_FIELDS);
  assert.equal(view.items[0].comment, '联系138****5678');
  assert.deepEqual([view.total, view.truncated, view.window_days, view.goods_id, view.stars, view.mall_id],
    [2100, true, 7, '101', [4, 5], '900001']);
  assert.equal(view.hints.length, 1);
  assert.equal(JSON.stringify(view).includes('PRIVATE'), false);
  const all = toGoodsReviewsView({ total: 0, truncated: false, items: [] }, { days: 30 });
  assert.deepEqual(all.headline, ['近 30 天全部星级评价 0 条']);
  assert.deepEqual([all.goods_id, all.stars, all.items], [null, null, []]);
});
