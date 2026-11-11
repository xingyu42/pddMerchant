import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { GOODS_LIST } from '../../src/adapter/endpoints/goods.js';
import {
  COST_TEMPLATE_VIEW_FIELDS, GOODS_STOCK_ITEM_FIELDS, GOODS_STOCK_SKU_FIELDS, GOODS_VIEW_FIELDS,
  toCostTemplateView, toGoodsStockView, toGoodsView,
} from '../../src/services/views/goods.js';
import { PUBLISH_VIEW_FIELDS, toPublishView } from '../../src/services/views/goods-publish.js';
import { createUpstreamGoods } from '../fixtures/test-data.js';

// 与 services/goods.js listGoods 相同的链路：endpoint normalize → 商品记录
function recordOf(upstream) {
  return GOODS_LIST.normalize({ success: true, result: { total: 1, goods_list: [upstream] } }).goods[0];
}

const EXPECTED_GOODS_VIEW = Object.freeze({
  goods_id: '101',
  goods_name: 'Tea',
  quantity: 10,
  price_min_yuan: 12.9,
  price_max_yuan: 16.9,
  single_price_min_yuan: 15.9,
  single_price_max_yuan: 19.9,
  promotion: { name: 'Synthetic 限时折扣', price_min_yuan: 11.9, price_max_yuan: 15.9 },
});

describe('goods view projection', () => {
  it('projects SKU price arrays (fen) into yuan ranges and trims promotion', () => {
    const view = toGoodsView(recordOf(createUpstreamGoods()));
    assert.deepEqual(view, EXPECTED_GOODS_VIEW);
    assert.deepEqual(Object.keys(view), [...GOODS_VIEW_FIELDS]);
  });

  it('ignores unknown upstream fields', () => {
    const noisy = createUpstreamGoods({ unknown_flag: 1, extra: { nested: true } });
    noisy.promotion_goods = { ...noisy.promotion_goods, activity_extra: 'x' };
    assert.deepEqual(toGoodsView(recordOf(noisy)), EXPECTED_GOODS_VIEW);
  });

  it('keeps absent prices and promotion null instead of zero', () => {
    const view = toGoodsView({ goods_id: 7, goods_name: 'Bare', quantity: 0 });
    assert.equal(view.goods_id, '7');
    assert.equal(view.quantity, 0);
    for (const key of ['price_min_yuan', 'price_max_yuan', 'single_price_min_yuan', 'single_price_max_yuan', 'promotion']) {
      assert.equal(view[key], null, key);
    }
    assert.equal(toGoodsView({ promotion: 'invalid' }).promotion, null);
  });

  it('accepts a single price and skips non-numeric SKU prices', () => {
    const view = toGoodsView({ sku_group_price: 990, sku_price: [null, '1500', 'x', 1200] });
    assert.equal(view.price_min_yuan, 9.9);
    assert.equal(view.price_max_yuan, 9.9);
    assert.equal(view.single_price_min_yuan, 12);
    assert.equal(view.single_price_max_yuan, 15);
  });

  it('projects cost templates to id and name only', () => {
    const view = toCostTemplateView({ id: 3001, name: 'Synthetic', free_province_need: null });
    assert.deepEqual(view, { template_id: '3001', name: 'Synthetic' });
    assert.deepEqual(Object.keys(view), [...COST_TEMPLATE_VIEW_FIELDS]);
  });
});

describe('goods stock view projection', () => {
  const stockRecord = (overrides = {}) => ({ goods_id: 101, goods_name: 'Tea', quantity: 30, low_stock_sku_count: 1,
    skus: [{ sku_id: 1011, spec: ' 红色-M ', quantity: 0, on_sale: true, low_stock: true, extra: 'drop' },
      { sku_id: 1012, spec: '', quantity: null, on_sale: null, low_stock: false }], ...overrides });

  it('appends the service-owned low sku count and whitelisted skus with text ids', () => {
    const view = toGoodsStockView(stockRecord());
    assert.deepEqual(Object.keys(view), GOODS_STOCK_ITEM_FIELDS);
    assert.equal(view.low_stock_sku_count, 1);
    assert.deepEqual(view.skus, [
      { sku_id: '1011', spec: '红色-M', quantity: 0, on_sale: true, low_stock: true },
      { sku_id: '1012', spec: null, quantity: null, on_sale: null, low_stock: false },
    ]);
    for (const sku of view.skus) assert.deepEqual(Object.keys(sku), GOODS_STOCK_SKU_FIELDS);
  });

  it('keeps unavailable sku data null and an empty sku list as zero', () => {
    const unavailable = toGoodsStockView(stockRecord({ skus: null, low_stock_sku_count: null }));
    assert.equal(unavailable.skus, null);
    assert.equal(unavailable.low_stock_sku_count, null);
    const empty = toGoodsStockView(stockRecord({ skus: [], low_stock_sku_count: 0 }));
    assert.deepEqual(empty.skus, []);
    assert.equal(empty.low_stock_sku_count, 0);
  });
});

describe('goods.list sku normalization', () => {
  const skusOf = (skuList) => recordOf(createUpstreamGoods({ sku_list: skuList })).sku_list;

  it('keeps only id, spec, count stock and raw on-sale flag', () => {
    assert.deepEqual(skusOf([{ skuId: 1011, spec: '红色-M', skuQuantity: '6', isOnsale: true, skuPrice: 1590 }]),
      [{ skuId: 1011, spec: '红色-M', skuQuantity: 6, isOnsale: true }]);
  });

  it.each([-1, 'abc', '', { value: 3 }, undefined, null])('maps non-count stock %s to null', (skuQuantity) => {
    assert.equal(skusOf([{ skuId: 1, skuQuantity }])[0].skuQuantity, null);
  });

  it.each([undefined, 'x', {}])('marks a missing or non-array sku_list (%s) as unavailable', (skuList) => {
    assert.equal(skusOf(skuList), null);
  });

  it('distinguishes zero skus from unavailable sku data', () => {
    assert.deepEqual(skusOf([]), []);
    assert.deepEqual(skusOf([null]), [{ skuId: null, spec: null, skuQuantity: null, isOnsale: null }]);
  });
});

describe('publish view', () => {
  const live = {
    goods_id: 5001, goods_commit_id: 7001, status: 'draft', cost_template_id: 3001,
    source_title: 'Synthetic', category_path: '食品 > 茶', property_mapping: { mapped_count: 4, skipped_count: 1 },
    sku_preview_count: 2, image_transform: 'disabled', submit: undefined,
  };
  const mock = { goods_id: 5001, goods_commit_id: 7001, source_goods_id: '123', status: 'submitted', source_title: 'S', cost_template_id: 3001, submit: { success: true } };

  it('gives live and fixture flows the same key set', () => {
    const liveView = toPublishView(live, { sourceGoodsId: '123', mallId: '900001' });
    const mockView = toPublishView(mock, { sourceGoodsId: '123', mallId: '900001' });
    assert.deepEqual(Object.keys(liveView), [...PUBLISH_VIEW_FIELDS]);
    assert.deepEqual(Object.keys(mockView), [...PUBLISH_VIEW_FIELDS]);
  });

  it('labels status and states facts in the headline', () => {
    const view = toPublishView(live, { sourceGoodsId: '123' });
    assert.equal(view.status, '草稿');
    assert.equal(view.image_transform_enabled, false);
    assert.deepEqual(view.property_mapping, { mapped_count: 4, skipped_count: 1 });
    assert.deepEqual(view.headline, [
      '已保存草稿：商品 5001（来源商品 123），未提交发布',
      '运费模板 3001，类目 食品 > 茶',
      '属性映射 4 项，跳过 1 项',
    ]);
    assert.equal(toPublishView(mock).status, '已提交');
    assert.equal(toPublishView({ status: 'weird' }).status, '未知(weird)');
  });
});
