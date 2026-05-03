import { test } from 'vitest';
import assert from 'node:assert/strict';
import { resolveCompareWindows, compareShopDiagnosis } from '../src/services/diagnose/trend-compare.js';

// ---------- resolveCompareWindows ----------

test('resolveCompareWindows: default 7-day windows', () => {
  const nowSec = 1746576000;
  const r = resolveCompareWindows({ nowSec, days: 7 });
  assert.equal(r.current.days, 7);
  assert.equal(r.current.until, nowSec);
  assert.equal(r.current.since, nowSec - 7 * 86400);
  assert.equal(r.previous.until, nowSec - 7 * 86400);
  assert.equal(r.previous.since, nowSec - 14 * 86400);
});

test('resolveCompareWindows: custom days=30', () => {
  const nowSec = 1746576000;
  const r = resolveCompareWindows({ nowSec, days: 30 });
  assert.equal(r.current.days, 30);
  assert.equal(r.current.since, nowSec - 30 * 86400);
  assert.equal(r.previous.since, nowSec - 60 * 86400);
  assert.equal(r.previous.until, nowSec - 30 * 86400);
});

test('resolveCompareWindows: previous.until === current.since (no gap)', () => {
  const r = resolveCompareWindows({ nowSec: 1000000, days: 7 });
  assert.equal(r.previous.until, r.current.since);
});

// ---------- compareShopDiagnosis ----------

test('compareShopDiagnosis: full comparison with delta', () => {
  const current = {
    score: 72,
    dimensions: {
      orders: { score: 75 },
      inventory: { score: 85 },
      promo: { score: 60 },
      funnel: { score: 70 },
    },
  };
  const previous = {
    score: 77,
    dimensions: {
      orders: { score: 80 },
      inventory: { score: 80 },
      promo: { score: 70 },
      funnel: { score: 65 },
    },
  };
  const r = compareShopDiagnosis({ current, previous });
  assert.equal(r.score_delta, -5);
  assert.equal(r.dimensions.orders.delta, -5);
  assert.equal(r.dimensions.promo.delta, -10);
  assert.equal(r.dimensions.funnel.delta, 5);
  assert.equal(r.dimensions.inventory.delta, null);
  assert.equal(r.dimensions.inventory.note, 'current_snapshot_only');
  assert.ok(r.regressions.length >= 1);
  assert.ok(r.improvements.length >= 1);
});

test('compareShopDiagnosis: delta arithmetic — delta === current - previous', () => {
  const current = { score: 60, dimensions: { orders: { score: 50 }, promo: { score: 70 }, funnel: { score: 60 } } };
  const previous = { score: 80, dimensions: { orders: { score: 80 }, promo: { score: 80 }, funnel: { score: 80 } } };
  const r = compareShopDiagnosis({ current, previous });
  assert.equal(r.score_delta, 60 - 80);
  assert.equal(r.dimensions.orders.delta, 50 - 80);
  assert.equal(r.dimensions.promo.delta, 70 - 80);
  assert.equal(r.dimensions.funnel.delta, 60 - 80);
});

test('compareShopDiagnosis: previous=0 → delta_pct=null', () => {
  const current = { score: 50, dimensions: { orders: { score: 50 } } };
  const previous = { score: 0, dimensions: { orders: { score: 0 } } };
  const r = compareShopDiagnosis({ current, previous });
  assert.equal(r.score_delta_pct, null);
  assert.equal(r.dimensions.orders.delta_pct, null);
});

test('compareShopDiagnosis: current===previous → delta=0, delta_pct=0', () => {
  const current = { score: 75, dimensions: { orders: { score: 80 }, promo: { score: 70 }, funnel: { score: 75 } } };
  const previous = { score: 75, dimensions: { orders: { score: 80 }, promo: { score: 70 }, funnel: { score: 75 } } };
  const r = compareShopDiagnosis({ current, previous });
  assert.equal(r.score_delta, 0);
  assert.equal(r.score_delta_pct, 0);
  assert.equal(r.dimensions.orders.delta, 0);
  assert.equal(r.dimensions.orders.delta_pct, 0);
});

test('compareShopDiagnosis: partial previous (missing dimensions)', () => {
  const current = { score: 60, dimensions: { orders: { score: 60 }, promo: { score: 50 } } };
  const previous = { score: 70, dimensions: { orders: { score: 70 } } };
  const r = compareShopDiagnosis({ current, previous });
  assert.equal(r.dimensions.promo.current, 50);
  assert.equal(r.dimensions.promo.previous, null);
  assert.equal(r.dimensions.promo.delta, null);
});

test('compareShopDiagnosis: null previous → all deltas null', () => {
  const current = { score: 60, dimensions: { orders: { score: 60 } } };
  const r = compareShopDiagnosis({ current, previous: null });
  assert.equal(r.score_delta, null);
  assert.equal(r.dimensions.orders.delta, null);
});

test('compareShopDiagnosis: null current → returns null', () => {
  const r = compareShopDiagnosis({ current: null, previous: null });
  assert.equal(r, null);
});

test('compareShopDiagnosis: inventory always current_snapshot_only', () => {
  const current = { score: 80, dimensions: { inventory: { score: 90 } } };
  const previous = { score: 80, dimensions: { inventory: { score: 85 } } };
  const r = compareShopDiagnosis({ current, previous });
  assert.equal(r.dimensions.inventory.current, 90);
  assert.equal(r.dimensions.inventory.previous, null);
  assert.equal(r.dimensions.inventory.delta, null);
  assert.equal(r.dimensions.inventory.note, 'current_snapshot_only');
});

// ---------- regressions and improvements sorting ----------

test('compareShopDiagnosis: regressions sorted by delta ascending (worst first)', () => {
  const current = { score: 50, dimensions: { orders: { score: 60 }, promo: { score: 40 }, funnel: { score: 55 } } };
  const previous = { score: 80, dimensions: { orders: { score: 70 }, promo: { score: 80 }, funnel: { score: 60 } } };
  const r = compareShopDiagnosis({ current, previous });
  assert.ok(r.regressions.length >= 2);
  for (let i = 1; i < r.regressions.length; i += 1) {
    assert.ok(r.regressions[i - 1].delta <= r.regressions[i].delta);
  }
});
