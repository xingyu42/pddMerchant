import { test } from 'vitest';
import assert from 'node:assert/strict';
import { analyzePromoRoi } from '../src/services/promo-roi.js';

// ---------- Grouping: plan ----------

test('analyzePromoRoi: by=plan groups by planId:adId', () => {
  const input = {
    entities: [
      { planId: 1, adId: 101, adName: 'A', impression: 1000, click: 50, gmv: 5000, spend: 1000 },
      { planId: 2, adId: 102, adName: 'B', impression: 2000, click: 100, gmv: 3000, spend: 2000 },
    ],
    totals: {},
  };
  const r = analyzePromoRoi(input, { by: 'plan' });
  assert.equal(r.by, 'plan');
  assert.equal(r.rows.length, 2);
  assert.equal(r.summary.total_rows, 2);
});

// ---------- Grouping: sku ----------

test('analyzePromoRoi: by=sku groups by goodsId', () => {
  const input = {
    entities: [
      { planId: 1, adId: 101, goodsId: 2001, goodsName: 'T恤', impression: 1000, click: 50, gmv: 5000, spend: 500 },
      { planId: 2, adId: 102, goodsId: 2001, goodsName: 'T恤', impression: 2000, click: 80, gmv: 3000, spend: 800 },
      { planId: 3, adId: 103, goodsId: 2002, goodsName: '裤子', impression: 500, click: 10, gmv: 1000, spend: 200 },
    ],
    totals: {},
  };
  const r = analyzePromoRoi(input, { by: 'sku' });
  assert.equal(r.rows.length, 2);
  const tshirt = r.rows.find((x) => x.goods_id === 2001);
  assert.equal(tshirt.gmv, 8000);
  assert.equal(tshirt.spend, 1300);
});

test('analyzePromoRoi: by=sku falls back to goodsName when goodsId null', () => {
  const input = {
    entities: [
      { planId: 1, adId: 101, goodsId: null, goodsName: '袜子', impression: 100, click: 5, gmv: 200, spend: 50 },
      { planId: 2, adId: 102, goodsId: null, goodsName: '袜子', impression: 200, click: 10, gmv: 300, spend: 80 },
    ],
    totals: {},
  };
  const r = analyzePromoRoi(input, { by: 'sku' });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].gmv, 500);
  assert.equal(r.rows[0].spend, 130);
});

// ---------- Grouping: channel ----------

test('analyzePromoRoi: by=channel groups by scenesType', () => {
  const input = {
    entities: [
      { planId: 1, adId: 101, scenesType: 1, promotionType: 'search', impression: 1000, click: 50, gmv: 5000, spend: 500 },
      { planId: 2, adId: 102, scenesType: 1, promotionType: 'search', impression: 2000, click: 80, gmv: 3000, spend: 800 },
      { planId: 3, adId: 103, scenesType: 2, promotionType: 'scene', impression: 500, click: 10, gmv: 1000, spend: 200 },
    ],
    totals: {},
  };
  const r = analyzePromoRoi(input, { by: 'channel' });
  assert.equal(r.rows.length, 2);
});

// ---------- ROI arithmetic ----------

test('analyzePromoRoi: ROI = gmv / spend, rounded to 2 decimals', () => {
  const input = {
    entities: [
      { planId: 1, adId: 101, impression: 1000, click: 50, gmv: 15000, spend: 500 },
    ],
    totals: {},
  };
  const r = analyzePromoRoi(input, { by: 'plan' });
  assert.equal(r.rows[0].roi, 30.0);
  assert.equal(r.rows[0].status, 'scale');
});

test('analyzePromoRoi: spend=0 → roi=null, status=no_spend', () => {
  const input = {
    entities: [
      { planId: 1, adId: 101, impression: 0, click: 0, gmv: 0, spend: 0 },
    ],
    totals: {},
  };
  const r = analyzePromoRoi(input, { by: 'plan' });
  assert.equal(r.rows[0].roi, null);
  assert.equal(r.rows[0].status, 'no_spend');
});

test('analyzePromoRoi: spend>0, gmv=0 → roi=0, status=critical_waste', () => {
  const input = {
    entities: [
      { planId: 1, adId: 101, impression: 5000, click: 100, gmv: 0, spend: 3000 },
    ],
    totals: {},
  };
  const r = analyzePromoRoi(input, { by: 'plan' });
  assert.equal(r.rows[0].roi, 0);
  assert.equal(r.rows[0].status, 'critical_waste');
});

test('analyzePromoRoi: ROI>=2 → scale', () => {
  const input = {
    entities: [{ planId: 1, adId: 101, impression: 1000, click: 50, gmv: 4000, spend: 1000 }],
    totals: {},
  };
  const r = analyzePromoRoi(input);
  assert.equal(r.rows[0].roi, 4.0);
  assert.equal(r.rows[0].status, 'scale');
});

test('analyzePromoRoi: 1<=ROI<2 → optimize', () => {
  const input = {
    entities: [{ planId: 1, adId: 101, impression: 1000, click: 50, gmv: 1500, spend: 1000 }],
    totals: {},
  };
  const r = analyzePromoRoi(input);
  assert.equal(r.rows[0].roi, 1.5);
  assert.equal(r.rows[0].status, 'optimize');
});

test('analyzePromoRoi: ROI<1 → waste', () => {
  const input = {
    entities: [{ planId: 1, adId: 101, impression: 1000, click: 50, gmv: 500, spend: 1000 }],
    totals: {},
  };
  const r = analyzePromoRoi(input);
  assert.equal(r.rows[0].roi, 0.5);
  assert.equal(r.rows[0].status, 'waste');
});

// ---------- Inactive filtering ----------

test('analyzePromoRoi: inactive plans excluded by default', () => {
  const input = {
    entities: [
      { planId: 1, adId: 101, impression: 1000, click: 50, gmv: 5000, spend: 500, isDeleted: false },
      { planId: 2, adId: 102, impression: 2000, click: 80, gmv: 3000, spend: 200, isDeleted: true },
    ],
    totals: {},
  };
  const r = analyzePromoRoi(input, { includeInactive: false });
  assert.equal(r.rows.length, 1);
  assert.equal(r.summary.excluded_inactive, 1);
  assert.equal(r.summary.excluded_inactive_spend, 200);
});

test('analyzePromoRoi: inactive plans included with includeInactive=true', () => {
  const input = {
    entities: [
      { planId: 1, adId: 101, impression: 1000, click: 50, gmv: 5000, spend: 500, isDeleted: false },
      { planId: 2, adId: 102, impression: 2000, click: 80, gmv: 3000, spend: 200, planDeleted: true },
    ],
    totals: {},
  };
  const r = analyzePromoRoi(input, { includeInactive: true });
  assert.equal(r.rows.length, 2);
  assert.equal(r.summary.excluded_inactive, 0);
});

// ---------- Summary ----------

test('analyzePromoRoi: summary aggregates correctly', () => {
  const input = {
    entities: [
      { planId: 1, adId: 101, impression: 1000, click: 50, gmv: 10000, spend: 500 },
      { planId: 2, adId: 102, impression: 2000, click: 80, gmv: 800, spend: 2000 },
      { planId: 3, adId: 103, impression: 500, click: 10, gmv: 0, spend: 1000 },
    ],
    totals: {},
  };
  const r = analyzePromoRoi(input);
  assert.equal(r.summary.total_rows, 3);
  assert.equal(r.summary.scale_count, 1);
  assert.equal(r.summary.waste_count, 2);
  assert.equal(r.summary.waste_spend, 3000);
  assert.equal(r.summary.total_spend, 3500);
  assert.equal(r.summary.total_gmv, 10800);
  assert.equal(r.summary.overall_roi, Number((10800 / 3500).toFixed(2)));
});

// ---------- Zero spend overall ----------

test('analyzePromoRoi: all zero spend → overall_roi=null', () => {
  const input = {
    entities: [
      { planId: 1, adId: 101, impression: 0, click: 0, gmv: 0, spend: 0 },
    ],
    totals: {},
  };
  const r = analyzePromoRoi(input);
  assert.equal(r.summary.overall_roi, null);
});

// ---------- Empty input ----------

test('analyzePromoRoi: empty entities → empty rows', () => {
  const r = analyzePromoRoi({ entities: [], totals: {} });
  assert.equal(r.rows.length, 0);
  assert.equal(r.summary.total_rows, 0);
});

test('analyzePromoRoi: null input → empty rows', () => {
  const r = analyzePromoRoi(null);
  assert.equal(r.rows.length, 0);
});

// ---------- CTR calculation ----------

test('analyzePromoRoi: CTR computed correctly per row', () => {
  const input = {
    entities: [
      { planId: 1, adId: 101, impression: 10000, click: 250, gmv: 5000, spend: 1000 },
    ],
    totals: {},
  };
  const r = analyzePromoRoi(input);
  assert.equal(r.rows[0].ctr, 0.025);
});

// ---------- Break-even threshold ----------

test('analyzePromoRoi: custom breakEvenRoi=1.5 reclassifies rows', () => {
  const input = {
    entities: [
      { planId: 1, adId: 101, impression: 1000, click: 50, gmv: 1200, spend: 1000 },
    ],
    totals: {},
  };
  const defaultResult = analyzePromoRoi(input, { breakEvenRoi: 1.0 });
  assert.equal(defaultResult.rows[0].status, 'optimize');

  const strictResult = analyzePromoRoi(input, { breakEvenRoi: 1.5 });
  assert.equal(strictResult.rows[0].status, 'waste');
});

// ---------- Rows sorted by ROI descending ----------

test('analyzePromoRoi: rows sorted by ROI descending', () => {
  const input = {
    entities: [
      { planId: 1, adId: 101, impression: 100, click: 5, gmv: 500, spend: 1000 },
      { planId: 2, adId: 102, impression: 100, click: 5, gmv: 10000, spend: 1000 },
      { planId: 3, adId: 103, impression: 100, click: 5, gmv: 2000, spend: 1000 },
    ],
    totals: {},
  };
  const r = analyzePromoRoi(input);
  assert.ok(r.rows[0].roi >= r.rows[1].roi);
  assert.ok(r.rows[1].roi >= r.rows[2].roi);
});
