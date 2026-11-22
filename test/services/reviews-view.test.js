import { it } from 'vitest';
import assert from 'node:assert/strict';
import { toReviewsView, toGoodsReviewsView, REVIEW_TAG_FIELDS, ISSUE_TYPE_FIELDS, REVIEW_FIELDS,
  GOODS_SCORES_FIELDS, GOODS_SCORE_FIELDS, GOODS_REVIEWS_FILTER_FIELDS, DEFAULT_GOODS_REVIEWS_FILTER }
  from '../../src/services/views/reviews.js';

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
  assert.deepEqual(GOODS_REVIEWS_FILTER_FIELDS, ['mode', 'min_length']);
  assert.deepEqual(DEFAULT_GOODS_REVIEWS_FILTER, { mode: 'substantive', min_length: 1 });
  const reviews = { total: 2100, truncated: true,
    items: [{ goodsId: 101, descScore: 5, comment: '联系13812345678', name: 'PRIVATE' }] };
  const view = toGoodsReviewsView(reviews, { days: 7, goodsId: '101', stars: ['4', '5'],
    hints: ['list_truncated'], mallId: '900001' });
  assert.deepEqual(view.headline, ['近 7 天商品 101 的 4、5 星评价 2100 条，实质内容 1 条', '已采集 1 条，结果已截断']);
  assert.deepEqual(Object.keys(view.items[0]), REVIEW_FIELDS);
  assert.deepEqual(Object.keys(view.filter), GOODS_REVIEWS_FILTER_FIELDS);
  assert.equal(view.items[0].comment, '联系138****5678');
  assert.deepEqual([view.total, view.fetched_count, view.filtered_out_count, view.truncated,
    view.window_days, view.goods_id, view.stars, view.mall_id],
  [2100, 1, 0, true, 7, '101', [4, 5], '900001']);
  assert.deepEqual(view.filter, { mode: '实质内容', min_length: 1 });
  assert.equal(view.hints.length, 1);
  assert.equal(JSON.stringify(view).includes('PRIVATE'), false);
  const empty = toGoodsReviewsView({ total: 0, truncated: false, items: [] }, { days: 30 });
  assert.deepEqual(empty.headline, ['近 30 天全部星级评价 0 条，实质内容 0 条']);
  assert.deepEqual([empty.goods_id, empty.stars, empty.items, empty.fetched_count, empty.filtered_out_count],
    [null, null, [], 0, 0]);
  const all = toGoodsReviewsView({
    total: 2100,
    truncated: true,
    items: [
      { goodsId: 101, descScore: 5, status: 4, comment: '该用户觉得商品很好，给出了5星好评' },
      { goodsId: 102, descScore: 5, status: 2, comment: '物流很快' },
    ],
  }, { days: 7, goodsId: '101', stars: ['4', '5'], filter: { mode: 'all', min_length: null },
    hints: ['list_truncated'], mallId: '900001' });
  assert.deepEqual(all.headline, ['近 7 天商品 101 的 4、5 星评价 2100 条', '已采集 2 条，结果已截断']);
  assert.deepEqual([all.total, all.fetched_count, all.filtered_out_count, all.items.length], [2100, 2, 0, 2]);
  assert.deepEqual(all.filter, { mode: '全部', min_length: null });
});

it('filters placeholders, empty, punct/emoji, digits, single-char repeats and 4-5 star media/tag-only reviews while keeping substantive and negative reviews', () => {
  const placeholders = [
    '该用户未填写文字评价',
    '该用户觉得商品较好',
    '该用户觉得商品很好，给出了5星好评',
    '该用户觉得商品稍有不足',
    '该用户觉得商品不符合预期',
    '该用户觉得商品一般',
    '该用户觉得商品很好，给出去了5星好评',
  ];
  const dropped = [
    { goodsId: 1, descScore: 5, status: 4, comment: '系统标记4的占位' },
    ...placeholders.map((comment, idx) => ({ goodsId: 10 + idx, descScore: 5, status: null, comment: ` ${comment} ` })),
    { goodsId: 20, descScore: 5, comment: '' },
    { goodsId: 21, descScore: 5, comment: '   \n\t ' },
    { goodsId: 22, descScore: 4, comment: null },
    { goodsId: 23, descScore: 5, comment: '。。。！！！' },
    { goodsId: 24, descScore: 5, comment: '👍👍👍' },
    { goodsId: 25, descScore: 5, comment: '666' },
    { goodsId: 26, descScore: 5, comment: '13812345678' },
    { goodsId: 27, descScore: 5, comment: '好好' },
    { goodsId: 28, descScore: 5, comment: '哈哈哈哈' },
    { goodsId: 29, descScore: 5, comment: 'AaAa' },
    { goodsId: 30, descScore: 5, comment: '好！好！' },
    { goodsId: 31, descScore: 5, comment: 'a1A' },
    { goodsId: 32, descScore: 5, comment: '', pictureCount: 2, video: 'SYN-VIDEO', keywords: ['做工好'] },
    { goodsId: 33, descScore: 4, comment: '   ', keywords: ['物流快'] },
    { goodsId: 34, score: 4, descScore: 2, status: 4, comment: '该用户觉得商品较好' },
    { goodsId: 35, descScore: 5, status: 2, comment: '\u2139\uFE0F' },
    { goodsId: 36, descScore: 5, status: 2, comment: '\u2139' },
    { goodsId: 37, score: 0, descScore: 0, comment: '' },
    { goodsId: 38, score: 0, descScore: 2.5, comment: '' },
    { goodsId: 39, score: -1, descScore: 5, comment: '' },
  ];
  const kept = [
    { goodsId: 101, descScore: 5, status: 2, comment: '差' },
    { goodsId: 102, descScore: 5, status: 2, comment: '假' },
    { goodsId: 103, descScore: 5, comment: '破了' },
    { goodsId: 104, descScore: 5, comment: '尺码小' },
    { goodsId: 105, descScore: 5, comment: '38码' },
    { goodsId: 106, descScore: 5, status: 4, comment: '该用户觉得商品很好，给出了5星好评', appendReview: '追评13987654321有问题' },
    { goodsId: 107, descScore: 5, comment: '该用户未填写文字评价', appendReview: '该用户未填写文字评价' },
    { goodsId: 108, descScore: 3, status: 4, comment: '该用户未填写文字评价' },
    { goodsId: 109, descScore: 2, comment: '13812345678', pictureCount: 1 },
    { goodsId: 110, score: 3, descScore: 5, status: 4, comment: '该用户未填写文字评价' },
    { goodsId: 111, score: 2, descScore: null, comment: '' },
  ];
  const view = toGoodsReviewsView({ total: 2500, truncated: true, items: [...dropped, ...kept] },
    { days: 30, hints: ['list_truncated'] });
  assert.deepEqual(view.items.map((item) => item.goods_id), kept.map((item) => String(item.goodsId)));
  assert.equal(view.total, 2500);
  assert.equal(view.fetched_count, dropped.length + kept.length);
  assert.equal(view.filtered_out_count, dropped.length);
  assert.deepEqual(view.headline, [
    `近 30 天全部星级评价 2500 条，实质内容 ${kept.length} 条`,
    `已采集 ${dropped.length + kept.length} 条，结果已截断`,
  ]);
  assert.equal(view.items.find((item) => item.goods_id === '106').append_comment, '追评139****4321有问题');
  assert.equal(view.items.find((item) => item.goods_id === '108').comment, '该用户未填写文字评价');
  assert.equal(view.items.find((item) => item.goods_id === '109').comment, '138****5678');
  for (const item of view.items) {
    assert.deepEqual(Object.keys(item), REVIEW_FIELDS);
    assert.equal(Object.hasOwn(item, 'status'), false);
  }
  const diagnoseView = toReviewsView({ reviews: { total: dropped.length, truncated: false, items: dropped } }, { days: 30 });
  assert.equal(diagnoseView.negative_reviews.items.length, dropped.length);
});

it('filters strictly by cleaned valid character count in min_length mode without negative-review fallback', () => {
  const dropped = [
    { goodsId: 301, descScore: 5, status: 4, comment: '该用户觉得商品很好，给出了5星好评' },
    { goodsId: 302, descScore: 1, status: 4, comment: '该用户未填写文字评价' },
    { goodsId: 303, score: 2, descScore: null, comment: '差' },
    { goodsId: 304, descScore: 5, status: 2, comment: '破了' },
    { goodsId: 305, descScore: 5, status: 2, comment: '尺码小' },
    { goodsId: 306, descScore: 5, status: 2, comment: '好好好好好' },
    { goodsId: 307, descScore: 5, status: 2, comment: '66666👍' },
    { goodsId: 308, descScore: 5, status: 2, comment: '不错', appendReview: '满意' },
  ];
  const kept = [
    { goodsId: 401, descScore: 5, status: 2, comment: '尺码正好' },
    { goodsId: 402, descScore: 5, status: 2, comment: '1234abcd' },
    { goodsId: 403, descScore: 5, status: 4, comment: '该用户觉得商品较好', appendReview: '追评13987654321有划痕' },
    { goodsId: 404, descScore: 2, status: 2, comment: '联系13812345678处理' },
  ];
  const view = toGoodsReviewsView({ total: 2500, truncated: true, items: [...dropped, ...kept] }, {
    days: 7,
    goodsId: '101',
    stars: ['4', '5'],
    filter: { mode: 'min_length', min_length: 4 },
    hints: ['list_truncated'],
    mallId: '900001',
  });
  assert.deepEqual(view.items.map((item) => item.goods_id), ['401', '402', '403', '404']);
  assert.deepEqual([view.total, view.fetched_count, view.filtered_out_count, view.truncated], [2500, 12, 8, true]);
  assert.deepEqual(view.filter, { mode: '最小字数', min_length: 4 });
  assert.deepEqual(view.headline, [
    '近 7 天商品 101 的 4、5 星评价 2500 条，有效字数 ≥ 4 字 4 条',
    '已采集 12 条，结果已截断',
  ]);
  assert.equal(view.items.find((item) => item.goods_id === '403').append_comment, '追评139****4321有划痕');
  assert.equal(view.items.find((item) => item.goods_id === '404').comment, '联系138****5678处理');
  for (const item of view.items) {
    assert.deepEqual(Object.keys(item), REVIEW_FIELDS);
    assert.equal(Object.hasOwn(item, 'status'), false);
  }
  const emojiView = toGoodsReviewsView({
    total: 2,
    truncated: false,
    items: [
      { goodsId: 405, descScore: 5, status: 2, comment: '\u2139\uFE0F' },
      { goodsId: 406, descScore: 5, status: 2, comment: '差\u2139\uFE0F' },
    ],
  }, { days: 30, filter: { mode: 'min_length', min_length: 1 } });
  assert.deepEqual(emojiView.items.map((item) => item.goods_id), ['406']);
});

it('projects goods scores with caliber, rounded averages, zero-review nulls and headline', () => {
  const goodsScores = {
    total: 2,
    truncated: false,
    items: [
      { goodsId: 201, goodsName: '商品A', goodsUnfkUndfltRevCnt1m: 38,
        avgDescRevScr1m: 4.89473684, avgLgstRevScr1m: 4.756, avgServRevScr1m: 4.912 },
      { goodsId: '202', goodsName: '零评价商品', goodsUnfkUndfltRevCnt1m: 0,
        avgDescRevScr1m: 0, avgLgstRevScr1m: 0, avgServRevScr1m: 0 },
    ],
  };
  const view = toReviewsView({ reviews: { total: 0, truncated: false, items: [] }, goodsScores }, { days: 60 });
  assert.deepEqual(Object.keys(view.goods_scores), GOODS_SCORES_FIELDS);
  assert.deepEqual(Object.keys(view.goods_scores.items[0]), GOODS_SCORE_FIELDS);
  assert.deepEqual(view.goods_scores, {
    caliber: '数据中心-评价数据',
    window_days: 30,
    total: 2,
    truncated: false,
    items: [
      { goods_id: '201', goods_name: '商品A', review_count: 38,
        desc_score_avg: 4.89, logistics_score_avg: 4.76, service_score_avg: 4.91 },
      { goods_id: '202', goods_name: '零评价商品', review_count: 0,
        desc_score_avg: null, logistics_score_avg: null, service_score_avg: null },
    ],
  });
  assert.deepEqual(view.headline, ['近 60 天中差评 0 条', '近 30 日有效评价商品 1 个']);
  const withoutScores = toReviewsView({ reviews: { total: 0, truncated: false, items: [] }, goodsScores: null }, { days: 30 });
  assert.equal(withoutScores.goods_scores, null);
  assert.deepEqual(withoutScores.headline, ['近 30 天中差评 0 条']);
  const nullCountView = toReviewsView({ reviews: { total: 0, truncated: false, items: [] },
    goodsScores: { total: 1, truncated: false, items: [{ goodsId: '203', goodsName: '缺失计数',
      goodsUnfkUndfltRevCnt1m: null, avgDescRevScr1m: 0, avgLgstRevScr1m: 0, avgServRevScr1m: 0 }] } }, { days: 30 });
  assert.deepEqual(nullCountView.goods_scores.items[0], { goods_id: '203', goods_name: '缺失计数', review_count: null,
    desc_score_avg: null, logistics_score_avg: null, service_score_avg: null });
  assert.deepEqual(nullCountView.headline, ['近 30 天中差评 0 条', '近 30 日有效评价商品 0 个']);
});
