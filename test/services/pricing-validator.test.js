import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { buildPricingPlan, validatePricingPlan } from '../../src/services/pricing-validator.js';

describe('buildPricingPlan', () => {
  it('builds valid plan from source price', () => {
    const plan = buildPricingPlan({ price: '10.00' });
    assert.equal(plan.sourcePrice, 10);
    assert.equal(plan.groupPrice, '10.20'); // 10 * 1.02
    assert.equal(plan.singlePrice, '11.50'); // 10 * 1.15
    assert.equal(plan.marketPrice, '18.00'); // 10 * 1.8
    assert.deepEqual(plan.warnings, []);
  });

  it('handles zero/invalid source price', () => {
    const plan = buildPricingPlan({ price: '0' });
    assert.equal(plan.sourcePrice, 0);
    assert(plan.warnings.includes('source_price_invalid'));
  });

  it('handles missing price', () => {
    const plan = buildPricingPlan({});
    assert(plan.warnings.includes('source_price_invalid'));
  });

  it('accepts custom multipliers', () => {
    const plan = buildPricingPlan({ price: '100' }, { singleMultiplier: 1.3, marketMultiplier: 2.5 });
    assert.equal(plan.singlePrice, '130.00');
    assert.equal(plan.marketPrice, '250.00');
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

  it('PBT invariant: market >= single >= group', () => {
    for (let i = 0; i < 20; i++) {
      const price = (Math.random() * 1000 + 0.01).toFixed(2);
      const plan = buildPricingPlan({ price });
      const g = parseFloat(plan.groupPrice);
      const s = parseFloat(plan.singlePrice);
      const m = parseFloat(plan.marketPrice);
      assert(m >= s, `market ${m} < single ${s} for price ${price}`);
      assert(s >= g, `single ${s} < group ${g} for price ${price}`);
    }
  });
});
