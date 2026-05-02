import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateActionPlan } from '../src/services/action-plan.js';

// ---------- Priority sorting ----------

test('generateActionPlan: actions sorted by priority_score descending', () => {
  const promoRoi = {
    rows: [
      { plan_id: 1, ad_name: 'A', status: 'critical_waste', spend: 5000, gmv: 0, roi: 0 },
      { plan_id: 2, ad_name: 'B', status: 'scale', spend: 500, gmv: 5000, roi: 10 },
      { plan_id: 3, ad_name: 'C', status: 'waste', spend: 2000, gmv: 800, roi: 0.4 },
    ],
  };
  const r = generateActionPlan({ promoRoi });
  for (let i = 1; i < r.actions.length; i += 1) {
    assert.ok(r.actions[i - 1].priority_score >= r.actions[i].priority_score);
  }
});

// ---------- Deduplication ----------

test('generateActionPlan: no duplicate target_type + target_id + action', () => {
  const promoRoi = {
    rows: [
      { plan_id: 1, ad_name: 'A', status: 'waste', spend: 1000, gmv: 500, roi: 0.5 },
    ],
  };
  const r = generateActionPlan({ promoRoi, promoRoi });
  const keys = r.actions.map((a) => `${a.target_type}:${a.target_id}:${a.action}`);
  assert.equal(new Set(keys).size, keys.length);
});

// ---------- Confidence levels ----------

test('generateActionPlan: increase_budget gets confidence=low (no COGS)', () => {
  const promoRoi = {
    rows: [
      { plan_id: 1, ad_name: 'A', status: 'scale', spend: 500, gmv: 5000, roi: 10 },
    ],
  };
  const r = generateActionPlan({ promoRoi });
  const scalePlan = r.actions.find((a) => a.action === 'increase_budget');
  assert.ok(scalePlan);
  assert.equal(scalePlan.confidence, 'low');
  assert.ok(scalePlan.reason.includes('无成本数据'));
});

// ---------- Degraded upstream ----------

test('generateActionPlan: null inputs → empty actions', () => {
  const r = generateActionPlan({});
  assert.equal(r.actions.length, 0);
  assert.equal(r.summary.total, 0);
  assert.equal(r.data_completeness.diagnosis, false);
  assert.equal(r.data_completeness.promo_roi, false);
});

test('generateActionPlan: diagnosis only → store-level actions', () => {
  const diagnosis = {
    dimensions: {
      orders: { status: 'red', detail: { delay_count: 3, shipping_p95_hours: 60 } },
      inventory: { status: 'red', detail: { out_of_stock: 5, out_of_stock_rate: 0.10 } },
    },
  };
  const r = generateActionPlan({ diagnosis });
  assert.ok(r.actions.length >= 2);
  assert.ok(r.actions.some((a) => a.action === 'process_delayed_orders'));
  assert.ok(r.actions.some((a) => a.action === 'improve_shipping'));
  assert.ok(r.actions.some((a) => a.action === 'restock_or_delist'));
});

// ---------- Empty actions ----------

test('generateActionPlan: no issues → empty actions', () => {
  const diagnosis = {
    dimensions: {
      orders: { status: 'green', detail: { delay_count: 0, shipping_p95_hours: 12 } },
      inventory: { status: 'green', detail: { out_of_stock: 0, out_of_stock_rate: 0 } },
    },
  };
  const r = generateActionPlan({ diagnosis });
  assert.equal(r.actions.length, 0);
});

// ---------- Limit ----------

test('generateActionPlan: respects limit option', () => {
  const promoRoi = {
    rows: Array.from({ length: 20 }, (_, i) => ({
      plan_id: i,
      ad_name: `Plan ${i}`,
      status: 'waste',
      spend: 1000,
      gmv: 500,
      roi: 0.5,
    })),
  };
  const r = generateActionPlan({ promoRoi }, { limit: 5 });
  assert.equal(r.actions.length, 5);
});

// ---------- Summary counts ----------

test('generateActionPlan: summary counts match', () => {
  const promoRoi = {
    rows: [
      { plan_id: 1, ad_name: 'A', status: 'critical_waste', spend: 5000, gmv: 0, roi: 0 },
      { plan_id: 2, ad_name: 'B', status: 'waste', spend: 2000, gmv: 800, roi: 0.4 },
      { plan_id: 3, ad_name: 'C', status: 'scale', spend: 500, gmv: 5000, roi: 10 },
    ],
  };
  const r = generateActionPlan({ promoRoi });
  assert.equal(r.summary.urgent + r.summary.important + r.summary.suggestion, r.summary.total);
  assert.equal(r.summary.total, r.actions.length);
});

// ---------- generated_at ----------

test('generateActionPlan: generated_at is valid ISO string', () => {
  const r = generateActionPlan({});
  assert.ok(r.generated_at);
  assert.ok(!Number.isNaN(Date.parse(r.generated_at)));
});

// ---------- data_completeness ----------

test('generateActionPlan: data_completeness reflects inputs', () => {
  const r = generateActionPlan({
    diagnosis: { dimensions: {} },
    promoRoi: { rows: [] },
    segmentation: { items: [] },
    compare: { dimensions: {} },
  });
  assert.equal(r.data_completeness.diagnosis, true);
  assert.equal(r.data_completeness.promo_roi, true);
  assert.equal(r.data_completeness.segmentation, true);
  assert.equal(r.data_completeness.trend_compare, true);
});

// ---------- Segmentation actions ----------

test('generateActionPlan: segmentation tier D generates clearance', () => {
  const segmentation = {
    items: [
      { tier: 'D', goods_id: '1', goods_name: 'Stale', composite_score: 10, action: 'clearance' },
    ],
  };
  const r = generateActionPlan({ segmentation });
  assert.ok(r.actions.some((a) => a.action === 'clearance' && a.target_id === '1'));
});

test('generateActionPlan: segmentation restock generates urgent action', () => {
  const segmentation = {
    items: [
      { tier: 'A', goods_id: '2', goods_name: 'Hot', composite_score: 90, action: 'restock' },
    ],
  };
  const r = generateActionPlan({ segmentation });
  const restock = r.actions.find((a) => a.action === 'restock');
  assert.ok(restock);
  assert.equal(restock.target_id, '2');
});

// ---------- Trend bonus ----------

test('generateActionPlan: trend bonus increases priority_score', () => {
  const promoRoi = {
    rows: [
      { plan_id: 1, ad_name: 'A', status: 'waste', spend: 1000, gmv: 500, roi: 0.5 },
    ],
  };
  const withoutTrend = generateActionPlan({ promoRoi });
  const withTrend = generateActionPlan({
    promoRoi,
    compare: { dimensions: { promo: { delta_pct: -20 } } },
  });
  const base = withoutTrend.actions[0].priority_score;
  const boosted = withTrend.actions[0].priority_score;
  assert.ok(boosted > base, `expected ${boosted} > ${base}`);
});
