import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';
import { GOODS_LIST } from '../../src/adapter/endpoints/goods.js';
import { getGoodsListView, getGoodsStockView, isLowStock, listGoods } from '../../src/services/goods.js';

beforeEach(() => vi.stubEnv('PDD_TEST_ADAPTER', ''));

describe('goods list identity mapping', () => {
  it('maps upstream id at both endpoint and service boundaries', async () => {
    const goods = { id: 673183509913, goods_name: 'Synthetic', quantity: 10 };
    const result = GOODS_LIST.normalize({ success: true, result: {
      total: 1, goods_list: [goods],
    } });
    assert.equal(result.goods[0].goods_id, goods.id);
    const execute = vi.fn(async () => ({ data: { total: 1, goods: [goods] } }));
    const listed = await listGoods({}, {}, { client: { execute } });
    assert.equal(listed.goods[0].goods_id, goods.id);
  });

  it.each([null, undefined, '', 'invalid'])('preserves missing or invalid totals and stock as null (%s)', async (value) => {
    const execute = vi.fn(async () => ({ data: { total: value, goods: [{ id: 101, quantity: value }] } }));
    const result = await listGoods({}, {}, { client: { execute } });
    assert.equal(result.total, null);
    assert.equal(result.goods[0].quantity, null);
    assert.equal(isLowStock(result.goods[0]), false);
  });

  it('preserves explicit zero totals and stock', async () => {
    const execute = vi.fn(async () => ({ data: { total: 0, goods: [{ id: 101, quantity: 0 }] } }));
    const result = await listGoods({}, {}, { client: { execute } });
    assert.equal(result.total, 0);
    assert.equal(result.goods[0].quantity, 0);
    assert.equal(isLowStock(result.goods[0]), true);
  });

  it('describes unavailable totals and skips unknown stock in command views', async () => {
    const execute = vi.fn(async () => ({ data: { goods: [{ id: 101, quantity: null }] } }));
    const ctx = { client: { execute } };
    const listed = await getGoodsListView({}, {}, ctx);
    assert.equal(listed.total, null);
    assert.deepEqual(listed.headline, ['在售商品总数未获取，本页 1 件']);
    const stock = await getGoodsStockView({}, {}, ctx);
    assert.deepEqual(stock.items, []);
    assert.equal(stock.headline[0], '本页扫描 1 件商品（在售总数未获取）');
  });

  it('alerts goods with unknown total stock when an on-sale sku is low, without counting it as total-low', async () => {
    const goods = [
      { id: 101, quantity: null, sku_list: [{ skuId: 1011, spec: '红色-M', skuQuantity: 2, isOnsale: 1 }] },
      { id: 102, quantity: null, sku_list: [{ skuId: 1021, spec: '蓝色-L', skuQuantity: 20, isOnsale: 1 }] },
    ];
    const execute = vi.fn(async () => ({ data: { total: 2, goods } }));
    const stock = await getGoodsStockView({}, {}, { client: { execute } });
    assert.deepEqual(stock.items.map((item) => [item.goods_id, item.quantity, item.low_stock_sku_count]), [['101', null, 1]]);
    assert.equal(stock.low_stock_count, 0);
    assert.deepEqual(stock.headline.slice(1), [
      '库存不高于 10 的商品 0 件（其中缺货 0 件）',
      '库存不高于 10 的在售规格 1 个（其中缺货 0 个），总库存高于 10 或缺失、因规格库存进入告警的商品 1 件',
    ]);
  });
});
