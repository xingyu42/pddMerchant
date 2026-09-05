import assert from 'node:assert/strict';
import { it } from 'vitest';
import { analyzePromoRoi } from '../../src/services/promo-roi.js';
import { SAMPLE_PROMO_ENTITIES } from '../fixtures/test-data.js';

it('calculates grouped and overall ROI from summed amounts, not an average of individual ratios', () => {
  const input = { entities: structuredClone(SAMPLE_PROMO_ENTITIES), totals: { spend: 999 } };
  const result = analyzePromoRoi(input);
  const first = result.rows.find((row) => row.key === 'p1:a1');
  assert.equal(first.spend, 400);
  assert.equal(first.gmv, 600);
  assert.equal(first.impression, 400);
  assert.equal(first.click, 40);
  assert.equal(first.roi, 1.5);
  assert.equal(first.ctr, 0.1);
  assert.equal(result.summary.total_spend, 500);
  assert.equal(result.summary.total_gmv, 600);
  assert.equal(result.summary.overall_roi, 1.2);
  assert.deepEqual(result.totals, { spend: 999 });
});

it.each([['plan', 'p1:a1'], ['sku', '101'], ['channel', '1']])('groups by %s with distinct entity keys', (by, key) => {
  const result = analyzePromoRoi({ entities: structuredClone(SAMPLE_PROMO_ENTITIES) }, { by });
  assert.equal(result.by, by);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows.find((row) => row.key === key).spend, 400);
});

it('keeps different advertisements in the same plan separate in plan grouping', () => {
  const result = analyzePromoRoi({ entities: [
    { planId: 'p1', adId: 'a1', spend: 10, gmv: 10 },
    { planId: 'p1', adId: 'a2', spend: 20, gmv: 40 },
  ] });
  assert.deepEqual(result.rows.map((row) => row.key), ['p1:a2', 'p1:a1']);
  assert.equal(result.summary.total_spend, 30);
});

it.each(['isDeleted', 'planDeleted', 'adDeleted'])('filters %s by default and supports explicit inclusion', (flag) => {
  const data = { entities: [...structuredClone(SAMPLE_PROMO_ENTITIES), { planId: 'gone', adId: 'gone', spend: 900, gmv: 0, [flag]: true }] };
  const active = analyzePromoRoi(data);
  assert.equal(active.summary.excluded_inactive, 1);
  assert.equal(active.summary.excluded_inactive_spend, 900);
  assert.equal(active.summary.total_spend, 500);
  const all = analyzePromoRoi(data, { includeInactive: true });
  assert.equal(all.summary.excluded_inactive, 0);
  assert.equal(all.summary.total_spend, 1400);
  assert.equal(all.summary.overall_roi, 0.43);
  assert.equal(all.rows.find((row) => row.plan_id === 'gone').is_inactive, true);
});

it('distinguishes a zero denominator from a real zero ROI and rounds display ratios', () => {
  const result = analyzePromoRoi({ entities: [
    { planId: 'none', spend: 0, gmv: 100, impression: 0, click: 0 },
    { planId: 'zero', spend: 100, gmv: 0 },
    { planId: 'fraction', spend: 10000, gmv: 12345, impression: 3, click: 1 },
  ] });
  const noSpend = result.rows.find((row) => row.plan_id === 'none');
  assert.equal(noSpend.roi, null);
  assert.equal(noSpend.ctr, 0);
  assert.equal(result.rows.find((row) => row.plan_id === 'zero').roi, 0);
  const fraction = result.rows.find((row) => row.plan_id === 'fraction');
  assert.equal(fraction.roi, 1.23);
  assert.equal(fraction.ctr, 0.3333);
  assert.deepEqual(result.rows.map((row) => row.plan_id), ['fraction', 'zero', 'none']);
});

it.each([{ items: [] }, { items: [{ spend: 0, gmv: 0 }] }])('returns null overall ROI when total spend is zero %#', ({ items }) => {
  const result = analyzePromoRoi({ entities: items });
  assert.equal(result.summary.total_spend, 0);
  assert.equal(result.summary.overall_roi, null);
});
