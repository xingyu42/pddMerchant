import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { matchSales } from '../../src/services/goods-sales-matcher.js';

const goods = (fields = {}) => ({ goods_id: '101', goods_name: 'Tea', quantity: 10, ...fields });

describe('goods sales matcher', () => {
  it('matches numeric and string IDs across flat and nested order items', () => {
    const result = matchSales([goods()], [
      { goodsId: 101, goodsName: 'Renamed', goods_number: 2 },
      { items: [{ goods_id: ' 101 ', goods_name: 'Tea', goods_quantity: 3 }] },
      { goods_id: '101', goods_name: 'Tea', goodsQuantity: 4 },
    ]);
    assert.equal(result.matchedBy, 'goods_id');
    assert.equal(result.byGoods.get('id:101').unitsSold, 9);
    assert.deepEqual(result.ambiguous, []);
    assert.deepEqual(result.warnings, []);
  });

  it.each([
    [null, '101', 'mixed'], ['101', null, 'mixed'], [null, null, 'goods_name'],
    [0, '101', 'mixed'], ['0', '101', 'mixed'], ['', '101', 'mixed'],
  ])('falls back by normalized name for goods ID %s and order ID %s', (goodsId, orderId, matchedBy) => {
    const result = matchSales([goods({ goods_id: goodsId, goods_name: ' Tea ' })],
      [{ goods_id: orderId, goods_name: '\uff34\uff45\uff41', quantity: 5 }]);
    assert.equal(result.matchedBy, matchedBy);
    assert.equal(result.byGoods.get('name:Tea').unitsSold, 5);
  });

  it('uses names for the whole sample when even one item lacks an ID', () => {
    const result = matchSales([goods(), goods({ goods_id: '202', goods_name: 'Cup' })],
      [{ goods_id: '101', goods_name: 'Tea', quantity: 2 }, { goods_name: 'Cup', quantity: 3 }]);
    assert.equal(result.matchedBy, 'goods_name');
    assert.deepEqual([...result.byGoods.keys()], ['name:Tea', 'name:Cup']);
    assert.equal(result.byGoods.get('name:Cup').unitsSold, 3);
  });

  it('excludes duplicate normalized names and reports their inventory samples', () => {
    const result = matchSales([goods({ goods_id: null, goods_name: ' Tea', quantity: 3 }),
      goods({ goods_id: null, goods_name: 'Tea ', quantity: 5 }),
      goods({ goods_id: null, goods_name: 'Cup', quantity: 2 })],
    [{ goods_name: 'Tea', quantity: 10 }, { goods_name: 'Cup', quantity: 1 }]);
    assert.equal(result.matchedBy, 'goods_name');
    assert.deepEqual([...result.byGoods.keys()], ['name:Cup']);
    assert.equal(result.byGoods.get('name:Cup').unitsSold, 1);
    assert.deepEqual(result.ambiguous, [{ normalized_name: 'Tea', sku_count: 2, sample_quantities: [3, 5] }]);
    assert.deepEqual(result.warnings, ['重名商品 "Tea" (2 个) 无法唯一匹配，已排除统计']);
  });

  it('keeps same-name products separate when both sources provide IDs', () => {
    const result = matchSales([goods(), goods({ goods_id: '202' })],
      [{ goods_id: '202', goods_name: 'Tea', quantity: 2 }]);
    assert.equal(result.matchedBy, 'goods_id');
    assert.equal(result.byGoods.get('id:101').unitsSold, 0);
    assert.equal(result.byGoods.get('id:202').unitsSold, 2);
    assert.deepEqual(result.ambiguous, []);
  });

  it('retains duplicate-ID buckets for consumers and ignores nameless or invalid orders', () => {
    const result = matchSales([goods(), goods({ quantity: 2 })], [null, {}, { goods_id: '101', quantity: 8 },
      { goods_id: '101', goods_name: 'Tea', quantity: 0 }]);
    assert.equal(result.byGoods.get('id:101').goods.length, 2);
    assert.equal(result.byGoods.get('id:101').unitsSold, 1);
  });

  it('distinguishes zero sales and unknown inventory, including an empty sample', () => {
    const result = matchSales([goods({ quantity: null })], []);
    assert.equal(result.matchedBy, 'goods_id');
    assert.equal(result.byGoods.get('id:101').unitsSold, 0);
    assert.equal(result.byGoods.get('id:101').goods[0].quantity, null);
    assert.equal(matchSales([goods({ goods_id: null })], []).matchedBy, 'goods_name');
    assert.deepEqual(matchSales([], []).byGoods, new Map());
  });
});
