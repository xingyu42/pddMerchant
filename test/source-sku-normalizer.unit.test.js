import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  buildSkuPreviewPlan,
  normalizeSourceSkuSnapshot,
} from '../src/adapter/goods-publish/source-sku-normalizer.js';

function decodedGoods(overrides = {}) {
  return {
    goodsID: '447841256386',
    linePrice: '59',
    skuDimensions: [
      { name: '颜色', values: [{ id: 'red', text: '红色' }, { id: 'blue', text: '蓝色' }] },
      { name: '尺码', values: [{ id: '90', text: '90' }] },
    ],
    skus: [
      {
        skuID: 'sku-red-90',
        groupPrice: '14.7',
        normalPrice: '25.8',
        marketPrice: 0,
        quantity: 0,
        thumbUrl: 'https://img.pddpic.com/red.jpg',
        specValues: { 颜色: '红色', 尺码: '90' },
      },
      {
        skuID: 'sku-blue-90',
        groupPrice: '15.7',
        normalPrice: '26.8',
        marketPrice: 0,
        quantity: 12,
        thumbUrl: 'https://img.pddpic.com/blue.jpg',
        specValues: { 颜色: '蓝色', 尺码: '90' },
      },
    ],
    ...overrides,
  };
}

describe('normalizeSourceSkuSnapshot', () => {
  it('converts real PDD yuan price strings to integer cents', () => {
    const result = normalizeSourceSkuSnapshot(decodedGoods());

    assert.equal(result.complete, true);
    assert.deepEqual(result.issues, []);
    assert.equal(result.sourceReferencePriceCents, 5900);
    assert.equal(result.skuDimensions.length, 2);
    assert.deepEqual(result.skus[0], {
      sourceSkuId: 'sku-red-90',
      specValues: { 颜色: '红色', 尺码: '90' },
      sourcePriceCents: 1470,
      sourceNormalPriceCents: 2580,
      stock: 0,
      thumbUrl: 'https://img.pddpic.com/red.jpg',
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
    source.skus[0].groupPrice = '14.701';
    source.skus[0].normalPrice = '¥25.80';
    delete source.skus[1].quantity;
    const result = normalizeSourceSkuSnapshot(source);

    assert.equal(result.complete, false);
    assert.ok(result.issues.includes('sku_price_invalid'));
    assert.ok(result.issues.includes('sku_normal_price_invalid'));
    assert.ok(result.issues.includes('sku_stock_missing'));
  });

  it('treats raw integer prices as yuan and preserves explicit cent fields', () => {
    const rawResult = normalizeSourceSkuSnapshot(decodedGoods({
      skuDimensions: [{ name: '颜色', values: ['红色'] }],
      skus: [{
        skuID: 'sku-red',
        groupPrice: '15',
        normalPrice: 25,
        quantity: 3,
        specValues: { 颜色: '红色' },
      }],
    }));
    const normalizedResult = normalizeSourceSkuSnapshot({
      sourceReferencePriceCents: 5900,
      skuDimensions: [{ name: '颜色', values: ['红色'] }],
      skus: [{
        sourceSkuId: 'sku-red',
        sourcePriceCents: 1500,
        sourceNormalPriceCents: 2500,
        stock: 3,
        specValues: { 颜色: '红色' },
      }],
    });

    assert.equal(rawResult.skus[0].sourcePriceCents, 1500);
    assert.equal(rawResult.skus[0].sourceNormalPriceCents, 2500);
    assert.equal(rawResult.sourceReferencePriceCents, 5900);
    assert.equal(normalizedResult.complete, true);
    assert.equal(normalizedResult.sourceReferencePriceCents, 5900);
    assert.equal(normalizedResult.skus[0].sourcePriceCents, 1500);
    assert.equal(normalizedResult.skus[0].sourceNormalPriceCents, 2500);
  });

  it('rejects a missing, non-positive, or non-strict source reference price', () => {
    const missing = normalizeSourceSkuSnapshot(decodedGoods({ linePrice: undefined }));
    const zero = normalizeSourceSkuSnapshot(decodedGoods({ linePrice: '0' }));
    const equalToMaxSingle = normalizeSourceSkuSnapshot(decodedGoods({ linePrice: '26.8' }));

    assert.ok(missing.issues.includes('source_reference_price_invalid'));
    assert.ok(zero.issues.includes('source_reference_price_invalid'));
    assert.ok(equalToMaxSingle.issues.includes('source_reference_price_not_above_single'));
  });

  it('rejects snapshots that exceed traversal safety limits', () => {
    const result = normalizeSourceSkuSnapshot({
      sourceReferencePriceCents: 10000,
      skuDimensions: Array.from({ length: 11 }, (_, index) => ({
        name: `规格${index}`,
        values: ['值'],
      })),
      skus: Array.from({ length: 501 }, (_, index) => ({
        skuID: `sku-${index}`,
        groupPrice: '1.00',
        normalPrice: '1.00',
        quantity: 1,
        specValues: {},
      })),
    });

    assert.equal(result.complete, false);
    assert.ok(result.issues.includes('sku_dimension_limit_exceeded'));
    assert.ok(result.issues.includes('source_sku_limit_exceeded'));
  });

  it('normalizes PDD spec_key/spec_value entries', () => {
    const source = decodedGoods({
      skuDimensions: [{ name: '颜色', values: ['红色'] }],
      skus: [{
        skuID: 'sku-red',
        groupPrice: '14.7',
        normalPrice: '25.8',
        quantity: 3,
        specs: [{ spec_key: '颜色', spec_value: '红色' }],
      }],
    });

    const result = normalizeSourceSkuSnapshot(source);

    assert.equal(result.complete, true);
    assert.deepEqual(result.skus[0].specValues, { 颜色: '红色' });
  });
});

describe('buildSkuPreviewPlan', () => {
  it('groups six sizes per color into one deterministic preview image', () => {
    const colors = ['灰色', '蓝色', '黄色'];
    const sizes = ['80', '90', '100', '110', '120', '130'];
    const snapshot = {
      skuDimensions: [
        { name: '颜色', values: colors.map((text) => ({ id: text, text })) },
        { name: '尺码', values: sizes.map((text) => ({ id: text, text })) },
      ],
      skus: colors.flatMap((color) => sizes.map((size) => ({
        specValues: { 颜色: color, 尺码: size },
        thumbUrl: `https://img.pddpic.com/${color}.jpg`,
      }))),
    };

    const result = buildSkuPreviewPlan(snapshot);

    assert.equal(result.ok, true);
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.plan, colors.map((merchantColor) => ({
      merchantColor,
      sourceImageUrl: `https://img.pddpic.com/${merchantColor}.jpg`,
    })));
  });

  it('fails closed when a color is missing an image or has conflicting images', () => {
    const base = {
      skuDimensions: [{ name: '颜色分类', values: ['红色', '蓝色'] }],
      skus: [
        { specValues: { 颜色分类: '红色' }, thumbUrl: '' },
        { specValues: { 颜色分类: '蓝色' }, thumbUrl: 'https://img.pddpic.com/blue-a.jpg' },
        { specValues: { 颜色分类: '蓝色' }, thumbUrl: 'https://img.pddpic.com/blue-b.jpg' },
      ],
    };

    const result = buildSkuPreviewPlan(base);

    assert.equal(result.ok, false);
    assert.ok(result.issues.includes('sku_preview_mapping_missing'));
    assert.ok(result.issues.includes('sku_preview_mapping_ambiguous'));
    assert.deepEqual(result.plan, []);
  });

  it('does not guess a color dimension', () => {
    const result = buildSkuPreviewPlan({
      skuDimensions: [{ name: '尺码', values: ['90'] }],
      skus: [{ specValues: { 尺码: '90' }, thumbUrl: 'https://img.pddpic.com/90.jpg' }],
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.issues, ['sku_preview_color_dimension_missing']);
  });
});
