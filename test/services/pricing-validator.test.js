import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { buildPricingPlan, validatePricingPlan } from '../../src/services/pricing-validator.js';

describe('buildPricingPlan', () => {
  function sourceWithSkus(overrides = {}) {
    return {
      sourceReferencePriceCents: 3000,
      skus: [
        {
          sourceSkuId: 'red-s',
          specValues: { 颜色: '红色', 尺码: 'S' },
          sourcePriceCents: 1000,
          sourceNormalPriceCents: 1500,
          stock: 0,
        },
        {
          sourceSkuId: 'blue-s',
          specValues: { 颜色: '蓝色', 尺码: 'S' },
          sourcePriceCents: 1200,
          sourceNormalPriceCents: 1800,
          stock: 8,
        },
      ],
      ...overrides,
    };
  }

  it('builds a separate price and stock plan for every source SKU', () => {
    const plan = buildPricingPlan(sourceWithSkus({ skus: [sourceWithSkus().skus[0]] }));
    assert.equal(plan.sourcePrice, 10);
    assert.equal(plan.groupPrice, '10.00');
    assert.equal(plan.singlePrice, '15.00');
    assert.equal(plan.marketPrice, '30.00');
    assert.deepEqual(plan.skuPricing[0], {
      sourceSkuId: 'red-s',
      specValues: { 颜色: '红色', 尺码: 'S' },
      sourcePriceCents: 1000,
      groupPrice: '10.00',
      singlePrice: '15.00',
      stock: 0,
    });
    assert.deepEqual(plan.warnings, []);
  });

  it('keeps different source SKU prices separate', () => {
    const plan = buildPricingPlan(sourceWithSkus());

    assert.equal(plan.skuPricing.length, 2);
    assert.equal(plan.skuPricing[0].groupPrice, '10.00');
    assert.equal(plan.skuPricing[0].singlePrice, '15.00');
    assert.equal(plan.skuPricing[1].groupPrice, '12.00');
    assert.equal(plan.skuPricing[1].singlePrice, '18.00');
    assert.deepEqual(plan.skuPrices, ['10.00', '12.00']);
    assert.equal(plan.marketPrice, '30.00');
  });

  it('copies the captured source group and normal prices into the draft plan', () => {
    const plan = buildPricingPlan(sourceWithSkus({
      sourceReferencePriceCents: 5900,
      skus: [{
        sourceSkuId: 'captured-sku',
        specValues: { 颜色分类: '灰色套装', 参考分类: '80' },
        sourcePriceCents: 1470,
        sourceNormalPriceCents: 2580,
        stock: 1000,
      }],
    }));

    assert.equal(plan.groupPrice, '14.70');
    assert.equal(plan.singlePrice, '25.80');
    assert.equal(plan.marketPrice, '59.00');
    assert.equal(plan.skuPricing[0].groupPrice, '14.70');
    assert.equal(plan.skuPricing[0].singlePrice, '25.80');
  });

  it('handles zero/invalid source SKU price', () => {
    const source = sourceWithSkus();
    source.skus[0].sourcePriceCents = 0;
    source.skus[1].sourceNormalPriceCents = 0;
    source.sourceReferencePriceCents = 0;
    const plan = buildPricingPlan(source);
    assert.equal(plan.sourcePrice, 0);
    assert(plan.warnings.includes('source_price_invalid'));
    assert(plan.warnings.includes('source_normal_price_invalid'));
    assert(plan.warnings.includes('source_reference_price_invalid'));
    assert.equal(validatePricingPlan(plan).ok, false);
  });

  it('handles missing structured SKU data', () => {
    const plan = buildPricingPlan({});
    assert(plan.warnings.includes('source_skus_missing'));
    assert(plan.warnings.includes('source_reference_price_invalid'));
  });

  it('does not derive the source reference price from either sale price', () => {
    const plan = buildPricingPlan(sourceWithSkus({
      sourceReferencePriceCents: 5900,
      skus: [sourceWithSkus().skus[0]],
    }));
    assert.equal(plan.groupPrice, '10.00');
    assert.equal(plan.singlePrice, '15.00');
    assert.equal(plan.marketPrice, '59.00');
  });
});

describe('validatePricingPlan', () => {
  it('validates correct price ordering', () => {
    const result = validatePricingPlan({
      sourcePrice: 10,
      groupPrice: '10.20',
      singlePrice: '11.50',
      marketPrice: '18.00',
      skuPrices: [],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.warnings, []);
  });

  it('errors when group > single', () => {
    const result = validatePricingPlan({
      sourcePrice: 10,
      groupPrice: '15.00',
      singlePrice: '12.00',
      marketPrice: '20.00',
      skuPrices: [],
    });
    assert.equal(result.ok, false);
    assert(result.errors.some(e => e.includes('groupPrice')));
  });

  it('requires the reference price to be strictly greater than every single price', () => {
    const result = validatePricingPlan({
      sourcePrice: 10,
      groupPrice: '10.00',
      singlePrice: '15.00',
      marketPrice: '15.00',
      skuPrices: ['10.00'],
      skuPricing: [{
        sourceSkuId: 'sku-a',
        specValues: {},
        groupPrice: '10.00',
        singlePrice: '15.00',
        stock: 1,
      }],
    });

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('must be greater')));
  });

  it('warns when SKU ratio exceeds limit', () => {
    const result = validatePricingPlan({
      sourcePrice: 10,
      groupPrice: '10.20',
      singlePrice: '11.50',
      marketPrice: '18.00',
      skuPrices: ['1.00', '10.00'],
    });
    assert(result.warnings.some(w => w.includes('SKU price ratio')));
  });

  it('warns when group/source ratio too high', () => {
    const result = validatePricingPlan({
      sourcePrice: 10,
      groupPrice: '50.00',
      singlePrice: '60.00',
      marketPrice: '80.00',
      skuPrices: [],
    });
    assert(result.warnings.some(w => w.includes('group/source ratio')));
  });

  it('rejects duplicate or missing multi-SKU specification mappings', () => {
    const baseSku = {
      groupPrice: '10.20',
      singlePrice: '11.50',
      stock: 1,
    };
    const duplicate = validatePricingPlan({
      sourcePrice: 10,
      groupPrice: '10.20',
      singlePrice: '11.50',
      marketPrice: '18.00',
      skuPrices: ['10.20', '10.20'],
      skuPricing: [
        { ...baseSku, sourceSkuId: 'sku-a', specValues: { 颜色: '红色' } },
        { ...baseSku, sourceSkuId: 'sku-b', specValues: { 颜色: '红色' } },
      ],
    });
    const missing = validatePricingPlan({
      sourcePrice: 10,
      groupPrice: '10.20',
      singlePrice: '11.50',
      marketPrice: '18.00',
      skuPrices: ['10.20', '10.20'],
      skuPricing: [
        { ...baseSku, sourceSkuId: 'sku-a', specValues: {} },
        { ...baseSku, sourceSkuId: 'sku-b', specValues: {} },
      ],
    });

    assert.equal(duplicate.ok, false);
    assert.ok(duplicate.errors.some((error) => error.includes('specification duplicate')));
    assert.equal(missing.ok, false);
    assert.ok(missing.errors.some((error) => error.includes('specification missing')));
  });

  it('PBT invariant: market >= single >= group', () => {
    for (let i = 0; i < 20; i++) {
      const sourcePriceCents = Math.floor(Math.random() * 100_000) + 1;
      const sourceNormalPriceCents = Math.floor(sourcePriceCents * 1.5);
      const sourceReferencePriceCents = sourceNormalPriceCents + 1;
      const plan = buildPricingPlan({
        sourceReferencePriceCents,
        skus: [{
          sourceSkuId: 'sku',
          specValues: {},
          sourcePriceCents,
          sourceNormalPriceCents,
          stock: 1,
        }],
      });
      const g = parseFloat(plan.groupPrice);
      const s = parseFloat(plan.singlePrice);
      const m = parseFloat(plan.marketPrice);
      assert(m > s, `market ${m} <= single ${s} for price ${sourcePriceCents}`);
      assert(s >= g, `single ${s} < group ${g} for price ${sourcePriceCents}`);
      assert.equal(plan.groupPrice, (sourcePriceCents / 100).toFixed(2));
      assert.equal(plan.singlePrice, (sourceNormalPriceCents / 100).toFixed(2));
      assert.equal(plan.marketPrice, (sourceReferencePriceCents / 100).toFixed(2));
    }
  });
});
