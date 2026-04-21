import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diagnoseShop,
  scoreOrdersHealth,
  scoreInventoryHealth,
  scorePromoHealth,
  scoreFunnelHealth,
  WEIGHTS,
} from '../src/services/diagnose/index.js';

// ---------- scoreOrdersHealth ----------

test('scoreOrdersHealth: missing input → partial', () => {
  const r = scoreOrdersHealth({});
  assert.equal(r.score, null);
  assert.equal(r.status, 'partial');
  assert.ok(r.issues.length >= 1);
});

test('scoreOrdersHealth: healthy shop → green (100)', () => {
  const r = scoreOrdersHealth({
    stats: { unship: 5, delay: 0 },
    listStats: { shipping_seconds: { p95: 3600 * 10 }, refund_rate: 0.02 },
  });
  assert.equal(r.score, 100);
  assert.equal(r.status, 'green');
  assert.equal(r.detail.shipping_p95_hours, 10);
  assert.equal(r.detail.refund_rate, 0.02);
});

test('scoreOrdersHealth: P95 > 48h + high refund + delay → red', () => {
  const r = scoreOrdersHealth({
    stats: { unship: 100, delay: 5 },
    listStats: { shipping_seconds: { p95: 3600 * 60 }, refund_rate: 0.15 },
  });
  // 100 - 30 (p95>48) - 30 (refund>10%) - 20 (delay) - 10 (unship>50) = 10
  assert.equal(r.score, 10);
  assert.equal(r.status, 'red');
  assert.ok(r.issues.length >= 3);
});

test('scoreOrdersHealth: P95 24-48h + mid refund → yellow', () => {
  const r = scoreOrdersHealth({
    stats: { unship: 10, delay: 0 },
    listStats: { shipping_seconds: { p95: 3600 * 30 }, refund_rate: 0.07 },
  });
  // 100 - 15 - 15 = 70
  assert.equal(r.score, 70);
  assert.equal(r.status, 'yellow');
});

// ---------- scoreInventoryHealth ----------

test('scoreInventoryHealth: empty goods → partial', () => {
  const r = scoreInventoryHealth({ goods: [] });
  assert.equal(r.score, null);
  assert.equal(r.status, 'partial');
});

test('scoreInventoryHealth: all in stock → green', () => {
  const goods = Array.from({ length: 10 }, (_, i) => ({ id: i, quantity: 100 }));
  const r = scoreInventoryHealth({ goods });
  assert.equal(r.score, 100);
  assert.equal(r.status, 'green');
  assert.equal(r.detail.total, 10);
  assert.equal(r.detail.out_of_stock, 0);
});

test('scoreInventoryHealth: > 5% out-of-stock → score drops 40', () => {
  const goods = [
    ...Array.from({ length: 10 }, () => ({ quantity: 0 })),    // 10 缺货
    ...Array.from({ length: 90 }, () => ({ quantity: 100 })),  // 90 正常
  ];
  // outRate = 0.10 > 0.05 → -40; lowOrOutRate = 0.10 > 0.10? 等于 0.10, 不 > → no second deduction
  const r = scoreInventoryHealth({ goods });
  assert.equal(r.score, 60);
  assert.equal(r.detail.out_of_stock, 10);
});

// ---------- scorePromoHealth ----------

test('scorePromoHealth: no totals → partial', () => {
  const r = scorePromoHealth({});
  assert.equal(r.score, null);
  assert.equal(r.status, 'partial');
});

test('scorePromoHealth: zero activity → partial', () => {
  const r = scorePromoHealth({
    totals: { impression: 0, click: 0, gmv: 0, spend: 0 },
  });
  assert.equal(r.score, null);
  assert.equal(r.status, 'partial');
});

test('scorePromoHealth: ROI<1 → red (loss)', () => {
  const r = scorePromoHealth({
    totals: { impression: 5000, click: 200, gmv: 100, spend: 300 },
  });
  // ROI = 0.33 < 1 → -40; CTR = 0.04 > 0.01 → no CTR deduction
  assert.equal(r.score, 60);
  assert.equal(r.detail.roi, 0.33);
});

test('scorePromoHealth: healthy ROI + good CTR → green', () => {
  const r = scorePromoHealth({
    totals: { impression: 5000, click: 200, gmv: 1000, spend: 100 },
  });
  // ROI = 10 (>2), CTR = 0.04 (>0.01) → no deductions
  assert.equal(r.score, 100);
  assert.equal(r.status, 'green');
});

// ---------- scoreFunnelHealth ----------

test('scoreFunnelHealth: no data → partial', () => {
  const r = scoreFunnelHealth({});
  assert.equal(r.score, null);
  assert.equal(r.status, 'partial');
});

test('scoreFunnelHealth: 0 visitors → partial', () => {
  const r = scoreFunnelHealth({ data: { visitors: 0 } });
  assert.equal(r.score, null);
  assert.equal(r.status, 'partial');
});

test('scoreFunnelHealth: healthy funnel → green', () => {
  const r = scoreFunnelHealth({
    data: { visitors: 1000, add_cart: 100, orders: 30, paid: 28 },
  });
  // cartRate=0.1 (>0.02), orderRate=0.3 (>0.1), paidRate=0.93 (>0.8) → no deductions
  assert.equal(r.score, 100);
  assert.equal(r.status, 'green');
});

test('scoreFunnelHealth: low paid rate → deduction', () => {
  const r = scoreFunnelHealth({
    data: { visitors: 1000, add_cart: 100, orders: 30, paid: 10 },
  });
  // paidRate = 0.33 < 0.8 with orders > 5 → -25
  assert.equal(r.score, 75);
});

// ---------- diagnoseShop (composite) ----------

test('diagnoseShop: returns null score when no dimensions provided', () => {
  const r = diagnoseShop({});
  assert.equal(r.score, null);
  assert.equal(r.status, 'partial');
  assert.equal(r.weight_used, 0);
});

test('diagnoseShop: uses WEIGHTS 0.40/0.25/0.25/0.10', () => {
  assert.equal(WEIGHTS.orders, 0.40);
  assert.equal(WEIGHTS.inventory, 0.25);
  assert.equal(WEIGHTS.promo, 0.25);
  assert.equal(WEIGHTS.funnel, 0.10);
});

test('diagnoseShop: partial dimensions contribute only their weight', () => {
  const r = diagnoseShop({
    orders: { stats: { unship: 5, delay: 0 }, listStats: { shipping_seconds: { p95: 3600 * 10 }, refund_rate: 0.02 } },
    // inventory / promo / funnel undefined → excluded
  });
  // only orders (100) with weight 0.40 → weighted avg = 100
  assert.equal(r.score, 100);
  assert.equal(r.status, 'green');
  assert.equal(r.weight_used, 0.40);
});

test('diagnoseShop: aggregates issues and hints across dimensions', () => {
  const r = diagnoseShop({
    orders: { stats: { unship: 5, delay: 3 }, listStats: {} },
    goods: [{ quantity: 0 }, { quantity: 0 }, ...Array.from({ length: 18 }, () => ({ quantity: 100 }))],
  });
  // expect orders issue (delay) AND inventory issue (out-of-stock)
  const dims = new Set(r.issues.map((i) => i.dimension));
  assert.ok(dims.has('orders'));
  assert.ok(dims.has('inventory'));
});
