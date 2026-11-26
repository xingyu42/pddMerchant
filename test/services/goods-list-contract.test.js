import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import { GOODS_LIST } from '../../src/adapter/endpoints/goods.js';
import { getGoodsListView, getGoodsStockView, isLowStock, listGoods } from '../../src/services/goods.js';

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

  it('maps sku on-sale flags from boolean or 0/1 and marks other shapes unknown', async () => {
    const flags = [true, 1, '1', false, 0, '0', 'yes', null];
    const goods = [{ id: 101, quantity: 0,
      sku_list: flags.map((isOnsale, index) => ({ skuId: index, spec: 'S', skuQuantity: 1, isOnsale })) }];
    const execute = vi.fn(async () => ({ data: { total: 1, goods } }));
    const [item] = (await getGoodsStockView({}, {}, { client: { execute } })).items;
    assert.deepEqual(item.skus.map((sku) => sku.on_sale), [true, true, true, false, false, false, null, null]);
    assert.deepEqual(item.skus.map((sku) => sku.low_stock), [true, true, true, false, false, false, false, false]);
    assert.equal(item.low_stock_sku_count, 3);
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

  it('passes through base catalog fields with zero counts preserved and unbound sentinels nulled', async () => {
    const goods = [{
      id: 101,
      goods_name: 'Tea',
      quantity: 5,
      sku_group_price: [1290, 1690],
      origin_sku_group_price: [1490, 1890],
      out_goods_sn: '',
      sold_quantity: 0,
      sold_quantity_for_thirty_days: 'abc',
      fav_cnt: 0,
      costTemplateId: '0',
      created_at: 1700000000,
      updated_at: 0,
    }];
    const execute = vi.fn(async () => ({ data: { total: 1, goods } }));
    const ctx = { client: { execute } };
    const listed = await getGoodsListView({}, {}, ctx);
    assert.equal(listed.items[0].out_goods_sn, null);
    assert.equal(listed.items[0].origin_price_min_yuan, 14.9);
    assert.equal(listed.items[0].origin_price_max_yuan, 18.9);
    assert.equal(listed.items[0].sold_quantity, 0);
    assert.equal(listed.items[0].sold_quantity_30d, null);
    assert.equal(listed.items[0].fav_count, 0);
    assert.equal(listed.items[0].cost_template_id, null);
    assert.equal(listed.items[0].created_at, '2023-11-15 06:13:20');
    assert.equal(listed.items[0].updated_at, null);

    const stock = await getGoodsStockView({}, {}, ctx);
    assert.equal(stock.items[0].origin_price_min_yuan, 14.9);
    assert.equal(stock.items[0].sold_quantity, 0);
    assert.equal(stock.items[0].cost_template_id, null);
  });
});
