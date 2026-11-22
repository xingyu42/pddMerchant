import { it } from 'vitest';
import assert from 'node:assert/strict';
import { REVIEWS_LIST, REVIEWS_KEYWORD_AGG, REVIEWS_TYPE_AGG, REVIEWS_PAGE_SIZE, REVIEWS_VIEW_LIMIT,
  REVIEWS_GOODS_SCORES, GOODS_SCORES_PAGE_SIZE, GOODS_SCORES_MAX_PAGES }
  from '../../src/adapter/endpoints/reviews.js';

it('sends exact signed POST payloads with page size forty and caller-supplied star and goods filters', () => {
  const params = { startTime: 100, endTime: 200, rangeType: 5, pageNo: 2, pageSize: 99, noise: 1 };
  for (const [spec, path] of [[REVIEWS_LIST, 'list'], [REVIEWS_KEYWORD_AGG, 'keywords/agg'],
    [REVIEWS_TYPE_AGG, 'type/agg']]) {
    assert.equal(spec.strategy, 'page-api');
    assert.equal(spec.nav.url, 'https://mms.pinduoduo.com/goods/evaluation/index');
    assert.equal(spec.apiUrl, `/saturn/reviews/${path}`);
  }
  // 缺省不带 descScore / goodsId：上游返回全店全部星级。
  assert.deepEqual(REVIEWS_LIST.buildPayload(params), { startTime: 100, endTime: 200, pageNo: 2, pageSize: 40 });
  assert.deepEqual(REVIEWS_LIST.buildPayload({ ...params, descScore: ['1', '2', '3'], goodsId: '101' }),
    { startTime: 100, endTime: 200, pageNo: 2, pageSize: 40, descScore: ['1', '2', '3'], goodsId: '101' });
  assert.equal(REVIEWS_LIST.buildPayload({ startTime: 100, endTime: 200 }).pageNo, 1);
  assert.equal(REVIEWS_VIEW_LIMIT % REVIEWS_PAGE_SIZE, 0);
  for (const spec of [REVIEWS_KEYWORD_AGG, REVIEWS_TYPE_AGG]) {
    assert.deepEqual(spec.buildPayload(params), { startTime: 100, endTime: 200, rangeType: 5 });
  }
});

it('whitelists nested review and aggregation fields, retaining only media counts and reply state', () => {
  const result = { totalRows: 1, data: [{ goodsId: 101, comment: '正文', appendReview: { comment: '追评', orderSn: 'PRIVATE' },
    keywords: [{ keywordName: '质量差', private: 'PRIVATE' }], pictures: ['PRIVATE'], reply: 'PRIVATE',
    name: 'PRIVATE', avatar: 'PRIVATE', orderId: 'PRIVATE', video: 'PRIVATE', score: 0 }] };
  assert.deepEqual(REVIEWS_LIST.normalize({ result }), { totalRows: 1, data: [{ goodsId: 101,
    comment: '正文', appendReview: '追评', keywords: ['质量差'], pictureCount: 1, replied: true, score: 0, status: null }] });
  assert.deepEqual(REVIEWS_KEYWORD_AGG.normalize({ result: { positiveKeywordList: [{ keywordName: '好', num: 2, noise: 1 }],
    negativeKeywordList: [] } }), { positiveKeywordList: [{ keywordName: '好', num: 2 }], negativeKeywordList: [] });
  assert.deepEqual(REVIEWS_TYPE_AGG.normalize({ result: { typeList: [{ typeName: '质量', positive: 1,
    negative: 2, proportion: 50, noise: 1 }] } }), { typeList: [{ typeName: '质量', positive: 1, negative: 2, proportion: 50 }] });
});

it('extracts integer review status for internal filtering and falls back to null when missing or non-integer', () => {
  const cases = [
    [4, 4],
    [2, 2],
    ['4', 4],
    [undefined, null],
    [null, null],
    [4.5, null],
    ['abc', null],
    [true, null],
  ];
  const result = {
    totalRows: cases.length,
    data: cases.map(([status]) => (status === undefined ? { goodsId: 101 } : { goodsId: 101, status })),
  };
  const normalized = REVIEWS_LIST.normalize({ result });
  assert.deepEqual(normalized.data.map((item) => item.status), cases.map(([, expected]) => expected));
});

it('rejects missing collections and totals while accepting explicit empty results', () => {
  for (const spec of [REVIEWS_LIST, REVIEWS_KEYWORD_AGG, REVIEWS_TYPE_AGG]) {
    assert.throws(() => spec.normalize({}), { code: 'E_NETWORK' });
  }
  assert.throws(() => REVIEWS_LIST.normalize({ result: { data: [] } }), { code: 'E_NETWORK' });
  assert.deepEqual(REVIEWS_LIST.normalize({ result: { totalRows: 0, data: [] } }), { totalRows: 0, data: [] });
});

// 真实账号实测：没有不满意标签的店铺 negativeKeywordList 为 null，满意标签照常返回。
it('reads an explicit null keyword list as empty while still rejecting a missing one', () => {
  const positiveKeywordList = [{ keywordName: '好', num: 2 }];
  assert.deepEqual(REVIEWS_KEYWORD_AGG.normalize({ result: { positiveKeywordList, negativeKeywordList: null } }),
    { positiveKeywordList, negativeKeywordList: [] });
  assert.deepEqual(REVIEWS_KEYWORD_AGG.normalize({ result: { positiveKeywordList: null, negativeKeywordList: null } }),
    { positiveKeywordList: [], negativeKeywordList: [] });
  assert.throws(() => REVIEWS_KEYWORD_AGG.normalize({ result: { positiveKeywordList } }), { code: 'E_NETWORK' });
  assert.throws(() => REVIEWS_KEYWORD_AGG.normalize({ result: null }), { code: 'E_NETWORK' });
  assert.throws(() => REVIEWS_TYPE_AGG.normalize({ result: { typeList: null } }), { code: 'E_NETWORK' });
  assert.throws(() => REVIEWS_LIST.normalize({ result: { totalRows: 0, data: null } }), { code: 'E_NETWORK' });
});

it('builds default page-10 payloads and whitelists goods score rows', () => {
  assert.equal(REVIEWS_GOODS_SCORES.strategy, 'page-api');
  assert.equal(REVIEWS_GOODS_SCORES.nav.url, 'https://mms.pinduoduo.com/sycm/goods_quality/comment');
  assert.equal(REVIEWS_GOODS_SCORES.apiUrl, '/sydney/api/saleQuality/queryGoodsEvaluateVO');
  assert.equal(REVIEWS_GOODS_SCORES.fixtureListKey, 'result.goodsEvaluates');
  assert.equal(GOODS_SCORES_PAGE_SIZE, 10);
  assert.equal(GOODS_SCORES_MAX_PAGES, 20);
  assert.deepEqual(REVIEWS_GOODS_SCORES.buildPayload({}), { pageSize: 10, pageNo: 1, sortCol: 5, sortType: 1 });
  assert.deepEqual(REVIEWS_GOODS_SCORES.buildPayload({ pageNo: 2, noise: 1 }),
    { pageSize: 10, pageNo: 2, sortCol: 5, sortType: 1 });
  const row = { goodsId: 201, goodsName: '商品名\uE100', goodsUnfkUndfltRevCnt1m: 38,
    avgDescRevScr1m: 4.8947, avgLgstRevScr1m: 4.756, avgServRevScr1m: 4.912,
    todayEvaluationCount: 3, avgDescRank: 12, avgLgstRank: 15, avgServRank: 18,
    starless4OrdrDfltRevCnt1m: 4, avgUapplDescRevScr1m: 4.8947, avgAntiDescCtgrpRevScrPct1m: 0,
    hdThumbUrl: 'https://img.example.test/SYN.jpg', goodsStatus: 1 };
  assert.deepEqual(REVIEWS_GOODS_SCORES.normalize({ result: { mallOprGoodsCntStd: 1, goodsEvaluates: [row] } }), {
    totalRows: 1,
    data: [{ goodsId: 201, goodsName: '商品名\uE100', goodsUnfkUndfltRevCnt1m: 38,
      avgDescRevScr1m: 4.8947, avgLgstRevScr1m: 4.756, avgServRevScr1m: 4.912 }],
  });
  assert.deepEqual(REVIEWS_GOODS_SCORES.normalize({ result: { mallOprGoodsCntStd: 0, goodsEvaluates: null } }),
    { totalRows: 0, data: [] });
});

it('rejects malformed goods scores shapes and PUA obfuscated metrics or goodsId', () => {
  const fullRow = { goodsId: 201, goodsName: '商品', goodsUnfkUndfltRevCnt1m: 1,
    avgDescRevScr1m: 5, avgLgstRevScr1m: 5, avgServRevScr1m: 5 };
  for (const raw of [{}, { result: null }, { result: { mallOprGoodsCntStd: 0 } },
    { result: { goodsEvaluates: [] } }, { result: { mallOprGoodsCntStd: -1, goodsEvaluates: [] } },
    { result: { mallOprGoodsCntStd: 1.5, goodsEvaluates: [] } }, { result: { mallOprGoodsCntStd: 1, goodsEvaluates: [null] } },
    { result: { mallOprGoodsCntStd: 1, goodsEvaluates: [[]] } },
    { result: { mallOprGoodsCntStd: 1, goodsEvaluates: [{ goodsId: '  ' }] } }]) {
    assert.throws(() => REVIEWS_GOODS_SCORES.normalize(raw), { code: 'E_NETWORK' });
  }
  for (const missingField of ['goodsUnfkUndfltRevCnt1m', 'avgDescRevScr1m', 'avgLgstRevScr1m', 'avgServRevScr1m']) {
    const partial = { ...fullRow };
    delete partial[missingField];
    assert.throws(() => REVIEWS_GOODS_SCORES.normalize({ result: { mallOprGoodsCntStd: 1, goodsEvaluates: [partial] } }),
      { code: 'E_NETWORK' });
  }
  const explicitNulls = { goodsId: 202, goodsName: '空值商品', goodsUnfkUndfltRevCnt1m: null,
    avgDescRevScr1m: null, avgLgstRevScr1m: null, avgServRevScr1m: null };
  assert.deepEqual(REVIEWS_GOODS_SCORES.normalize({ result: { mallOprGoodsCntStd: 1, goodsEvaluates: [explicitNulls] } }),
    { totalRows: 1, data: [explicitNulls] });
  for (const field of ['goodsId', 'goodsUnfkUndfltRevCnt1m', 'avgDescRevScr1m', 'avgLgstRevScr1m', 'avgServRevScr1m']) {
    const row = { goodsId: '201', goodsName: '正常商品', goodsUnfkUndfltRevCnt1m: 38,
      avgDescRevScr1m: 4.8, avgLgstRevScr1m: 4.8, avgServRevScr1m: 4.8, [field]: '\uE123' };
    assert.throws(() => REVIEWS_GOODS_SCORES.normalize({ result: { mallOprGoodsCntStd: 1, goodsEvaluates: [row] } }),
      { code: 'E_BUSINESS' });
  }
});
