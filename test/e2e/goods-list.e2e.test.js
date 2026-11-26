import { it } from 'vitest';
import assert from 'node:assert/strict';
import { runCli } from '../helpers/isolated-cli.js';
import { createUpstreamGoods, createUpstreamSku } from '../fixtures/test-data.js';

function listFixtures(goodsList, total = goodsList.length) {
  return { 'endpoints/goods.list.json': { success: true, result: { total, goods_list: goodsList } } };
}

it('expands 5-field skus with single xhr, distinguishes null vs [] and appends headline stats under --with-skus', () => {
  const goodsList = [
    createUpstreamGoods({
      goods_id: 101,
      quantity: 10,
      sku_list: [
        createUpstreamSku({ skuId: 1011, spec: '红色-M', outSkuSn: 'SKU-ERP-1', skuQuantity: 6, isOnsale: 1 }),
        createUpstreamSku({ skuId: 1012, spec: '蓝色-L', outSkuSn: '', skuQuantity: 4, isOnsale: 0 }),
      ],
    }),
    createUpstreamGoods({ goods_id: 102, goods_name: 'Cup', quantity: 0, sku_list: [] }),
    createUpstreamGoods({ goods_id: 103, goods_name: 'Bowl', quantity: 5, sku_list: undefined }),
  ];

  const { status, envelope } = runCli(['goods', 'list', '--with-skus'], {
    fixtures: listFixtures(goodsList),
  });
  assert.equal(status, 0);
  assert.equal(envelope.command, 'goods.list');
  assert.equal(envelope.meta.xhr_count, 1);
  assert.equal(envelope.data.items.length, 3);
  assert.deepEqual(envelope.data.items[0].skus, [
    { sku_id: '1011', spec: '红色-M', out_sku_sn: 'SKU-ERP-1', quantity: 6, on_sale: true },
    { sku_id: '1012', spec: '蓝色-L', out_sku_sn: null, quantity: 4, on_sale: false },
  ]);
  assert.deepEqual(envelope.data.items[1].skus, []);
  assert.equal(envelope.data.items[2].skus, null);
  assert.equal(envelope.data.headline.length <= 3, true);
  assert.deepEqual(envelope.data.headline, [
    '在售商品共 3 件，本页 3 件',
    '本页库存为 0 的商品 1 件',
    '本页规格共 2 个，规格数据缺失的商品 1 件',
  ]);
});

it('filters sku prices, sku sold quantity, thumb urls and unknown fields under goods list --with-skus', () => {
  const plainSku = { skuId: 1011, spec: '红色-M', outSkuSn: 'SKU-1', skuQuantity: 6, isOnsale: 1 };
  const noisySku = {
    ...plainSku,
    normalPrice: 1990,
    groupPrice: 1590,
    activityGroupPrice: 1190,
    skuSoldQuantity: 88,
    skuThumbUrl: 'https://example.invalid/sku-thumb.jpg',
    unknownSkuKey: 'SYN-SKU-NOISE',
  };
  const runWith = (sku) => {
    const res = runCli(['goods', 'list', '--with-skus'], {
      fixtures: listFixtures([createUpstreamGoods({ sku_list: [sku] })]),
    });
    assert.equal(res.status, 0);
    return res;
  };
  const plain = runWith(plainSku);
  const noisy = runWith(noisySku);
  assert.deepEqual(noisy.envelope.data, plain.envelope.data);
  assert.deepEqual(noisy.envelope.data.headline, [
    '在售商品共 1 件，本页 1 件',
    '本页规格共 1 个',
  ]);
  for (const token of [
    'normalPrice', 'groupPrice', 'activityGroupPrice', 'skuSoldQuantity',
    'skuThumbUrl', 'thumb_url', 'SYN-SKU-NOISE', '1190',
  ]) {
    assert.equal(noisy.stdout.includes(token), false, `stdout must not contain ${token}`);
  }
});

it('keeps empty catalog headline compact even when --with-skus is passed', () => {
  const { status, envelope } = runCli(['goods', 'list', '--with-skus', '--status', 'offline'], {
    fixtures: listFixtures([], 0),
  });
  assert.equal(status, 0);
  assert.deepEqual(envelope.data.items, []);
  assert.deepEqual(envelope.data.headline, ['已下架商品共 0 件']);
});
