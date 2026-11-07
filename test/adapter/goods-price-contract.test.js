import { it } from 'vitest';
import assert from 'node:assert/strict';
import { GOODS_PRICE_EXPAND, GOODS_PRICE_LIST } from '../../src/adapter/endpoints/goods-price.js';
import { RECEIPT_CALIBERS } from '../../src/services/goods-receipt.js';
import { receiptExpandSuccess, receiptGoods, receiptScene, receiptSku, receiptSuccess } from '../fixtures/test-data.js';

const REGULAR = { scenes: { single: 7, multi: 8 } };

function withoutNumber(scene) {
  const { number: _number, ...rest } = scene;
  return rest;
}

it('posts the price-management list payload with scenes, goods filter and upstream source type', () => {
  assert.equal(GOODS_PRICE_LIST.strategy, 'page-api');
  assert.equal(GOODS_PRICE_LIST.nav.url, 'https://mms.pinduoduo.com/kit/goods-price-management');
  assert.equal(GOODS_PRICE_LIST.apiUrl, '/madrid/price_manage/query_goods_price_with_page');
  assert.deepEqual(GOODS_PRICE_LIST.buildPayload({ page: 2, size: 5, goodsIds: ['101', '102'], scenes: REGULAR.scenes }), {
    page_num: 2, page_size: 5, only_low_price_warn_goods: false, only_red_line_goods: false,
    goods_search_condition: { goods_id_list: [101, 102] }, consult_price_scene_list: [7, 8],
    source_type: 'PriceManagent',
  });
  assert.equal('goods_search_condition' in GOODS_PRICE_LIST.buildPayload({ page: 1, size: 10, scenes: REGULAR.scenes }), false);
});

it('carries each caliber\'s own single and multi scenes in consult_price_scene_list', () => {
  const sceneList = (key) => GOODS_PRICE_LIST.buildPayload({ page: 1, size: 10,
    scenes: RECEIPT_CALIBERS[key] }).consult_price_scene_list;
  assert.deepEqual(Object.keys(RECEIPT_CALIBERS), ['regular', 'all']);
  assert.deepEqual(sceneList('regular'), [7, 8]);
  assert.deepEqual(sceneList('all'), [10, 11]);
});

it('rejects missing totals, prices and receipts instead of inventing zero', () => {
  const sku = (scene) => receiptSku(1, { scenes: [scene] });
  const base = receiptScene(7, { avg: 0, receipt: 100 });
  for (const raw of [
    { success: true, error_code: 1000000, result: { goods_price_info_list: [] } },
    receiptSuccess(1, [receiptGoods(1, [{ ...sku(base), group_price: undefined }])]),
    receiptSuccess(1, [receiptGoods(1, [sku({ ...base, promo_price_list: [] })])]),
    receiptSuccess(1, [receiptGoods(1, [sku({ ...base, avg_discount_amount: null })])]),
    receiptSuccess(1, [receiptGoods(1, [sku({ ...base, avg_discount_amount: 5, merge_promo_detail_list: undefined })])]),
    ...[undefined, null, -1, 1.5, 'x'].map((remain) => receiptSuccess(1, [{ ...receiptGoods(1, [sku(base)]),
      remain_sku_num: remain }])),
  ]) {
    assert.throws(() => GOODS_PRICE_LIST.normalize(raw, REGULAR), { code: 'E_NETWORK' });
  }
  const explicitNone = GOODS_PRICE_LIST.normalize(receiptSuccess(1, [receiptGoods(1, [
    sku({ ...base, merge_promo_detail_list: undefined })])]), REGULAR);
  assert.deepEqual(explicitNone.goods[0].sku_promo_list[0].calculate_price_detail_list[0].merge_promo_detail_list, []);
});

it('posts the expand payload with the goods id, current scenes and exposed sku ids on the same page', () => {
  assert.equal(GOODS_PRICE_EXPAND.strategy, 'page-api');
  assert.equal(GOODS_PRICE_EXPAND.nav.url, GOODS_PRICE_LIST.nav.url);
  assert.equal(GOODS_PRICE_EXPAND.apiUrl, '/madrid/price_manage/expand_all_sku');
  assert.equal(GOODS_PRICE_EXPAND.fixtureVariantKey, 'goods_id');
  assert.deepEqual(GOODS_PRICE_EXPAND.buildPayload({ goods_id: '101', scenes: { single: 10, multi: 11 },
    exposedSkuIds: ['1001', '1002'] }), { goods_id: 101, consult_price_scene_list: [10, 11],
    exposed_sku_id_list: [1001, 1002] });
});

it('normalizes expanded skus with the list sku rules and rejects a missing sku list', () => {
  const sku = receiptSku(1003, { scenes: [receiptScene(7, { avg: 0, receipt: 100 })] });
  const result = GOODS_PRICE_EXPAND.normalize(receiptExpandSuccess(101, [sku]), REGULAR);
  assert.deepEqual(result.sku_promo_list.map((item) => item.sku_id), ['1003']);
  assert.equal(result.sku_promo_list[0].calculate_price_detail_list[0].promo_price, 100);
  assert.throws(() => GOODS_PRICE_EXPAND.normalize({ success: true, error_code: 1000000, result: { goods_id: 101 } },
    REGULAR), { code: 'E_NETWORK' });
  assert.throws(() => GOODS_PRICE_EXPAND.normalize(receiptExpandSuccess(101, [{ ...sku, group_price: null }]),
    REGULAR), { code: 'E_NETWORK' });
});

it('validates only the requested caliber scenes and keeps foreign scenes as bare scene values', () => {
  const single = withoutNumber(receiptScene(7, { avg: 0, receipt: 100 }));
  const foreign = { consult_price_scene: 9, consult_price_scene_desc: '合成走势', avg_discount_amount: 0 };
  const sku = receiptSku(1, { scenes: [single, foreign, withoutNumber(receiptScene(10, { avg: 5, receipt: 95 }))] });
  for (const result of [GOODS_PRICE_LIST.normalize(receiptSuccess(1, [receiptGoods(1, [sku])]), REGULAR).goods[0],
    GOODS_PRICE_EXPAND.normalize(receiptExpandSuccess(1, [sku]), REGULAR)]) {
    assert.deepEqual(result.sku_promo_list[0].calculate_price_detail_list, [
      { consult_price_scene: 7, avg_discount_amount: 0, promo_price: 100, merge_promo_detail_list: [] },
      { consult_price_scene: 9 }, { consult_price_scene: 10 }]);
  }
});

it('still requires the multi scene quantity and a scene value on every scene', () => {
  const multi = withoutNumber(receiptScene(8, { avg: 0, receipt: 100 }));
  for (const scene of [multi, { consult_price_scene_desc: '合成场景' }]) {
    const raw = receiptSuccess(1, [receiptGoods(1, [receiptSku(1, { scenes: [scene] })])]);
    assert.throws(() => GOODS_PRICE_LIST.normalize(raw, REGULAR), { code: 'E_NETWORK' });
  }
  const quantity = GOODS_PRICE_LIST.normalize(receiptSuccess(1, [receiptGoods(1, [receiptSku(1, {
    scenes: [receiptScene(8, { avg: 0, receipt: 100, number: 3 })] })])]), REGULAR);
  assert.equal(quantity.goods[0].sku_promo_list[0].calculate_price_detail_list[0].number, 3);
});
