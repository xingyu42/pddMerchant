import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { normalizeSourceSkuSnapshot } from '../src/adapter/goods-publish/source-sku-normalizer.js';

function decodedGoods(overrides = {}) {
  return {
    goodsID: '447841256386',
    skuDimensions: [
      { name: '颜色', values: [{ id: 'red', text: '红色' }, { id: 'blue', text: '蓝色' }] },
      { name: '尺码', values: [{ id: '90', text: '90' }] },
    ],
    skus: [
      {
        skuID: 'sku-red-90',
        groupPrice: 1690,
        normalPrice: 1890,
        quantity: 0,
        specValues: { 颜色: '红色', 尺码: '90' },
      },
      {
        skuID: 'sku-blue-90',
        groupPrice: 1790,
        normalPrice: 1990,
        quantity: 12,
        specValues: { 颜色: '蓝色', 尺码: '90' },
      },
    ],
    ...overrides,
  };
}

describe('normalizeSourceSkuSnapshot', () => {
  it('normalizes explicit dimensions and per-SKU price/stock mappings', () => {
    const result = normalizeSourceSkuSnapshot(decodedGoods());

    assert.equal(result.complete, true);
    assert.deepEqual(result.issues, []);
    assert.equal(result.skuDimensions.length, 2);
    assert.deepEqual(result.skus[0], {
      sourceSkuId: 'sku-red-90',
      specValues: { 颜色: '红色', 尺码: '90' },
      sourcePriceCents: 1690,
      sourceNormalPriceCents: 1890,
      stock: 0,
    });
  });

  it('rejects multi-SKU data without an explicit specification mapping', () => {
    const result = normalizeSourceSkuSnapshot(decodedGoods({
      skus: decodedGoods().skus.map(({ specValues, ...sku }) => sku),
    }));

    assert.equal(result.complete, false);
    assert.ok(result.issues.includes('sku_spec_values_missing'));
  });

  it('rejects duplicate specification combinations', () => {
    const source = decodedGoods();
    source.skus[1].specValues = { ...source.skus[0].specValues };
    const result = normalizeSourceSkuSnapshot(source);

    assert.equal(result.complete, false);
    assert.ok(result.issues.includes('sku_combination_duplicate'));
  });

  it('rejects invalid prices and missing stock without inventing defaults', () => {
    const source = decodedGoods();
    source.skus[0].groupPrice = 0;
    delete source.skus[1].quantity;
    const result = normalizeSourceSkuSnapshot(source);

    assert.equal(result.complete, false);
    assert.ok(result.issues.includes('sku_price_invalid'));
    assert.ok(result.issues.includes('sku_stock_missing'));
  });

  it('rejects snapshots that exceed traversal safety limits', () => {
    const result = normalizeSourceSkuSnapshot({
      skuDimensions: Array.from({ length: 11 }, (_, index) => ({
        name: `规格${index}`,
        values: ['值'],
      })),
      skus: Array.from({ length: 501 }, (_, index) => ({
        skuID: `sku-${index}`,
        groupPrice: 100,
        quantity: 1,
        specValues: {},
      })),
    });

    assert.equal(result.complete, false);
    assert.ok(result.issues.includes('sku_dimension_limit_exceeded'));
    assert.ok(result.issues.includes('source_sku_limit_exceeded'));
  });
});
