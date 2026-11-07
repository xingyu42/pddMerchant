import { it } from 'vitest';
import assert from 'node:assert/strict';
import { GOODS_PRICE_EXPAND, GOODS_PRICE_LIST } from '../../src/adapter/endpoints/goods-price.js';
import { receiptExpandSuccess, receiptGoods, receiptScene, receiptSku, receiptSuccess } from '../fixtures/test-data.js';

it('posts the price-management list payload with scenes, goods filter and upstream source type', () => {
  assert.equal(GOODS_PRICE_LIST.strategy, 'page-api');
  assert.equal(GOODS_PRICE_LIST.nav.url, 'https://mms.pinduoduo.com/kit/goods-price-management');
  assert.equal(GOODS_PRICE_LIST.apiUrl, '/madrid/price_manage/query_goods_price_with_page');
  assert.deepEqual(GOODS_PRICE_LIST.buildPayload({ page: 2, size: 5, goodsIds: ['101', '102'], scenes: [7, 8] }), {
    page_num: 2, page_size: 5, only_low_price_warn_goods: false, only_red_line_goods: false,
    goods_search_condition: { goods_id_list: [101, 102] }, consult_price_scene_list: [7, 8],
    source_type: 'PriceManagent',
  });
  assert.equal('goods_search_condition' in GOODS_PRICE_LIST.buildPayload({ page: 1, size: 10, scenes: [7, 8] }), false);
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
  ]) {
    assert.throws(() => GOODS_PRICE_LIST.normalize(raw), { code: 'E_NETWORK' });
  }
  const explicitNone = GOODS_PRICE_LIST.normalize(receiptSuccess(1, [receiptGoods(1, [
    sku({ ...base, merge_promo_detail_list: undefined })])]));
  assert.deepEqual(explicitNone.goods[0].sku_promo_list[0].calculate_price_detail_list[0].merge_promo_detail_list, []);
});

it('posts the expand payload with the goods id, current scenes and exposed sku ids on the same page', () => {
  assert.equal(GOODS_PRICE_EXPAND.strategy, 'page-api');
  assert.equal(GOODS_PRICE_EXPAND.nav.url, GOODS_PRICE_LIST.nav.url);
  assert.equal(GOODS_PRICE_EXPAND.apiUrl, '/madrid/price_manage/expand_all_sku');
  assert.equal(GOODS_PRICE_EXPAND.fixtureVariantKey, 'goods_id');
  assert.deepEqual(GOODS_PRICE_EXPAND.buildPayload({ goods_id: '101', scenes: [10, 11],
    exposedSkuIds: ['1001', '1002'] }), { goods_id: 101, consult_price_scene_list: [10, 11],
    exposed_sku_id_list: [1001, 1002] });
});

it('normalizes expanded skus with the list sku rules and rejects a missing sku list', () => {
  const sku = receiptSku(1003, { scenes: [receiptScene(7, { avg: 0, receipt: 100 })] });
  const result = GOODS_PRICE_EXPAND.normalize(receiptExpandSuccess(101, [sku]));
  assert.deepEqual(result.sku_promo_list.map((item) => item.sku_id), ['1003']);
  assert.equal(result.sku_promo_list[0].calculate_price_detail_list[0].promo_price, 100);
  assert.throws(() => GOODS_PRICE_EXPAND.normalize({ success: true, error_code: 1000000, result: { goods_id: 101 } }),
    { code: 'E_NETWORK' });
  assert.throws(() => GOODS_PRICE_EXPAND.normalize(receiptExpandSuccess(101, [{ ...sku, group_price: null }])),
    { code: 'E_NETWORK' });
});
