import { it } from 'vitest';
import assert from 'node:assert/strict';
import { runCli } from '../helpers/isolated-cli.js';
import { createUpstreamGoods, createUpstreamSku } from '../fixtures/test-data.js';

function stockFixtures(goodsList) {
  return { 'endpoints/goods.list.json': { success: true, result: { total: goodsList.length, goods_list: goodsList } } };
}

function runStock(goodsList, args = []) {
  const result = runCli(['goods', 'stock', ...args], { fixtures: stockFixtures(goodsList) });
  assert.equal(result.status, 0, result.stderr);
  return result.envelope.data;
}

it('lists every sku of an alerted goods with id, spec, stock and on-sale flag', () => {
  const data = runStock([createUpstreamGoods()]);
  assert.equal(data.items.length, 1);
  assert.deepEqual(data.items[0].skus, [
    { sku_id: '1011', spec: '红色-M', quantity: 6, on_sale: true },
    { sku_id: '1012', spec: '蓝色-L', quantity: 4, on_sale: false },
  ]);
  assert.deepEqual(data.headline, ['本页扫描 1 件商品（在售共 1 件）', '库存不高于 10 的商品 1 件（其中缺货 0 件）']);
});

it('marks sku data unavailable as null, keeps zero skus as an empty list, and counts unavailable goods in headline', () => {
  const data = runStock([
    createUpstreamGoods({ goods_id: 101, sku_list: undefined }),
    createUpstreamGoods({ goods_id: 102, quantity: 0, sku_list: 'unexpected' }),
    createUpstreamGoods({ goods_id: 103, sku_list: [] }),
    createUpstreamGoods({ goods_id: 104, quantity: 50, sku_list: undefined }),
  ]);
  assert.deepEqual(data.items.map((item) => [item.goods_id, item.skus]), [['101', null], ['102', null], ['103', []]]);
  assert.deepEqual(data.headline, [
    '本页扫描 4 件商品（在售共 4 件）',
    '库存不高于 10 的商品 3 件（其中缺货 1 件）',
    '规格数据缺失的告警商品 2 件',
  ]);
});

it('reports a sku stock that is not a finite non-negative number as null and an unknown on-sale flag as null', () => {
  const { skuQuantity: _omitted, ...noQuantity } = createUpstreamSku({ skuId: 1013 });
  const { isOnsale: _unknown, ...noOnSale } = createUpstreamSku({ skuId: 1016, skuQuantity: '0' });
  const goods = createUpstreamGoods({ sku_list: [
    createUpstreamSku({ skuId: 1011, skuQuantity: -1 }),
    createUpstreamSku({ skuId: 1012, skuQuantity: 'abc' }),
    noQuantity,
    createUpstreamSku({ skuId: 1014, skuQuantity: { value: 3 } }),
    createUpstreamSku({ skuId: 1015, skuQuantity: '' }),
    noOnSale,
  ] });
  const [item] = runStock([goods]).items;
  assert.deepEqual(item.skus.map((sku) => [sku.sku_id, sku.quantity, sku.on_sale]), [
    ['1011', null, true], ['1012', null, true], ['1013', null, true], ['1014', null, true], ['1015', null, true],
    ['1016', 0, null],
  ]);
});

it('ignores extra upstream sku fields', () => {
  const plain = { skuId: 1011, spec: '红色-M', skuQuantity: 6, isOnsale: 1 };
  const noisy = { ...plain, skuPrice: 1590, extra: { nested: true }, receiver_mobile: 'SYN-MOBILE' };
  const data = runStock([createUpstreamGoods({ sku_list: [noisy] })]);
  assert.deepEqual(data, runStock([createUpstreamGoods({ sku_list: [plain] })]));
  assert.equal(JSON.stringify(data).includes('SYN-MOBILE'), false);
});

it('keeps goods list output unchanged when upstream goods carry sku data', () => {
  const list = (goods) => {
    const result = runCli(['goods', 'list'], { fixtures: stockFixtures([goods]) });
    assert.equal(result.status, 0, result.stderr);
    return result.envelope.data;
  };
  const data = list(createUpstreamGoods());
  assert.deepEqual(data, list(createUpstreamGoods({ sku_list: undefined })));
  assert.equal('skus' in data.items[0], false);
});
