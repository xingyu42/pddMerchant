import { test } from 'vitest';
import assert from 'node:assert/strict';
import { segmentGoods } from '../src/services/goods-segmentation.js';

// ---------- Tier assignment ----------

test('segmentGoods: high sales + low stock_days + good promo → tier A', () => {
  const goods = [
    { goods_id: 1, goods_name: 'Top Seller', quantity: 50 },
    { goods_id: 2, goods_name: 'Mid Seller', quantity: 100 },
    { goods_id: 3, goods_name: 'Low Seller', quantity: 100 },
    { goods_id: 4, goods_name: 'No Seller', quantity: 100 },
  ];
  const orders = [
    { goods_id: 1, goods_name: 'Top Seller', goods_quantity: 50 },
    { goods_id: 1, goods_name: 'Top Seller', goods_quantity: 30 },
    { goods_id: 2, goods_name: 'Mid Seller', goods_quantity: 10 },
  ];
  const promoRoi = { rows: [{ goods_id: 1, goods_name: 'Top Seller', roi: 5.0 }] };
  const r = segmentGoods({ goods, orders30d: orders, promoRoi }, { windowDays: 30 });
  const top = r.items.find((i) => i.goods_id === '1');
  assert.equal(top.tier, 'A');
  assert.ok(top.composite_score >= 75);
});

test('segmentGoods: zero sales + has quantity → tier D with clearance action', () => {
  const goods = [
    { goods_id: 1, goods_name: 'Unsold', quantity: 100 },
  ];
  const r = segmentGoods({ goods, orders30d: [] });
  assert.equal(r.items[0].tier, 'D');
  assert.equal(r.items[0].action, 'clearance');
  assert.equal(r.items[0].units_sold_30d, 0);
});

test('segmentGoods: quantity=0 + has sales → restock action', () => {
  const goods = [
    { goods_id: 1, goods_name: 'Out of Stock', quantity: 0 },
  ];
  const orders = [
    { goods_id: 1, goods_name: 'Out of Stock', goods_quantity: 20 },
  ];
  const r = segmentGoods({ goods, orders30d: orders });
  assert.equal(r.items[0].action, 'restock');
  assert.ok(r.items[0].tier === 'A' || r.items[0].tier === 'B');
});

// ---------- Percentile ranking ----------

test('segmentGoods: percentile ranking distributes correctly', () => {
  const goods = Array.from({ length: 10 }, (_, i) => ({
    goods_id: i + 1,
    goods_name: `G${i}`,
    quantity: 100,
  }));
  const orders = goods.map((g, i) => ({
    goods_id: g.goods_id,
    goods_name: g.goods_name,
    goods_quantity: (i + 1) * 10,
  }));
  const r = segmentGoods({ goods, orders30d: orders });
  assert.equal(r.items.length, 10);
  const top = r.items[0];
  assert.ok(top.sales_rank >= 80);
});

// ---------- Zero-sales handling ----------

test('segmentGoods: all zero sales → all tier D', () => {
  const goods = [
    { goods_id: 1, goods_name: 'A', quantity: 50 },
    { goods_id: 2, goods_name: 'B', quantity: 30 },
  ];
  const r = segmentGoods({ goods, orders30d: [] });
  for (const item of r.items) {
    assert.equal(item.tier, 'D');
    assert.equal(item.action, 'clearance');
  }
});

// ---------- goods_id fallback ----------

test('segmentGoods: goods_id null falls back to goods_name matching', () => {
  const goods = [
    { goods_id: null, goods_name: '袜子', quantity: 100 },
    { goods_id: null, goods_name: '手套', quantity: 50 },
  ];
  const orders = [
    { goods_name: '袜子', goods_quantity: 10 },
  ];
  const r = segmentGoods({ goods, orders30d: orders });
  assert.equal(r.summary.matched_by, 'goods_name');
  const sock = r.items.find((i) => i.goods_name === '袜子');
  assert.equal(sock.units_sold_30d, 10);
});

// ---------- Ambiguous groups ----------

test('segmentGoods: ambiguous goods_name groups excluded', () => {
  const goods = [
    { goods_id: null, goods_name: 'T恤', quantity: 50 },
    { goods_id: null, goods_name: 'T恤', quantity: 20 },
    { goods_id: null, goods_name: '裤子', quantity: 30 },
  ];
  const r = segmentGoods({ goods, orders30d: [] });
  assert.equal(r.items.length, 1);
  assert.equal(r.summary.ambiguous_groups, 1);
  assert.ok(r.warnings.some((w) => w.includes('T恤')));
});

// ---------- Truncated scan ----------

test('segmentGoods: truncated orders → data_completeness partial_orders', () => {
  const goods = [{ goods_id: 1, goods_name: 'A', quantity: 100 }];
  const r = segmentGoods({ goods, orders30d: [], truncated: true });
  assert.equal(r.summary.data_completeness, 'partial_orders');
});

// ---------- Empty input ----------

test('segmentGoods: empty goods → empty result', () => {
  const r = segmentGoods({ goods: [], orders30d: [] });
  assert.equal(r.items.length, 0);
  assert.equal(r.summary.total_goods, 0);
  assert.equal(r.summary.data_completeness, 'empty');
});

test('segmentGoods: null input → empty result', () => {
  const r = segmentGoods(null);
  assert.equal(r.items.length, 0);
});

// ---------- Tier mutual exclusivity and exhaustive ----------

test('segmentGoods: every item in exactly one tier and counts match', () => {
  const goods = Array.from({ length: 20 }, (_, i) => ({
    goods_id: i + 1,
    goods_name: `G${i}`,
    quantity: Math.floor(Math.random() * 200),
  }));
  const orders = goods.slice(0, 10).map((g) => ({
    goods_id: g.goods_id,
    goods_name: g.goods_name,
    goods_quantity: Math.floor(Math.random() * 50) + 1,
  }));
  const r = segmentGoods({ goods, orders30d: orders });
  const tierCounts = { A: 0, B: 0, C: 0, D: 0 };
  for (const item of r.items) {
    assert.ok(['A', 'B', 'C', 'D'].includes(item.tier));
    tierCounts[item.tier] += 1;
  }
  assert.equal(r.tiers.A.count, tierCounts.A);
  assert.equal(r.tiers.B.count, tierCounts.B);
  assert.equal(r.tiers.C.count, tierCounts.C);
  assert.equal(r.tiers.D.count, tierCounts.D);
  assert.equal(tierCounts.A + tierCounts.B + tierCounts.C + tierCounts.D, r.items.length);
});

// ---------- Composite score clamping ----------

test('segmentGoods: composite_score always 0-100 integer', () => {
  const goods = Array.from({ length: 5 }, (_, i) => ({
    goods_id: i + 1,
    goods_name: `G${i}`,
    quantity: i * 100,
  }));
  const orders = [
    { goods_id: 5, goods_name: 'G4', goods_quantity: 999 },
  ];
  const r = segmentGoods({ goods, orders30d: orders });
  for (const item of r.items) {
    assert.ok(Number.isInteger(item.composite_score));
    assert.ok(item.composite_score >= 0);
    assert.ok(item.composite_score <= 100);
  }
});

// ---------- stock_days calc ----------

test('segmentGoods: stock_days = quantity / daily_avg', () => {
  const goods = [{ goods_id: 1, goods_name: 'A', quantity: 300 }];
  const orders = [{ goods_id: 1, goods_name: 'A', goods_quantity: 30 }];
  const r = segmentGoods({ goods, orders30d: orders }, { windowDays: 30 });
  assert.equal(r.items[0].stock_days, 300);
});

// ---------- Promo ROI integration ----------

test('segmentGoods: promo roi boosts composite score', () => {
  const goods = [
    { goods_id: 1, goods_name: 'A', quantity: 100 },
    { goods_id: 2, goods_name: 'B', quantity: 100 },
  ];
  const orders = [
    { goods_id: 1, goods_name: 'A', goods_quantity: 10 },
    { goods_id: 2, goods_name: 'B', goods_quantity: 10 },
  ];
  const promoRoi = { rows: [{ goods_id: 1, goods_name: 'A', roi: 5.0 }] };
  const r = segmentGoods({ goods, orders30d: orders, promoRoi });
  const a = r.items.find((i) => i.goods_id === '1');
  const b = r.items.find((i) => i.goods_id === '2');
  assert.ok(a.promo_score > b.promo_score);
});
