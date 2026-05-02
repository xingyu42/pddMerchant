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

// ---------- scoreInventoryHealth: stale detection ----------

test('scoreInventoryHealth: stale via goods_id path', () => {
  const goods = [
    { goods_id: 1, goods_name: 'A', quantity: 100 },
    { goods_id: 2, goods_name: 'B', quantity: 50 },
    { goods_id: 3, goods_name: 'C', quantity: 30 },
  ];
  const orders30d = [
    { goods_id: 1, goods_name: 'A', goods_quantity: 5 },
    { goods_id: 2, goods_name: 'B', goods_quantity: 3 },
  ];
  const r = scoreInventoryHealth({ goods, orders30d });
  assert.equal(r.detail.matched_by, 'goods_id');
  assert.equal(r.detail.stale_count, 1);
  assert.deepEqual(r.detail.stale_sample, [{ goods_name: 'C', units_sold_30d: 0, quantity: 30 }]);
  assert.deepEqual(r.detail.ambiguous_groups, []);
});

test('scoreInventoryHealth: stale via goods_name fallback', () => {
  const goods = [
    { goods_name: 'A', quantity: 100 },
    { goods_name: 'B', quantity: 50 },
  ];
  const orders30d = [
    { goods_name: 'A', goods_quantity: 1 },
  ];
  const r = scoreInventoryHealth({ goods, orders30d });
  assert.equal(r.detail.matched_by, 'goods_name');
  assert.equal(r.detail.stale_count, 1);
  assert.equal(r.detail.stale_sample[0].goods_name, 'B');
});

test('scoreInventoryHealth: ambiguous goods_name groups excluded (only on goods_name path)', () => {
  const goods = [
    { goods_name: 'T恤', quantity: 50 },
    { goods_name: 'T恤', quantity: 20 },
    { goods_name: 'Z', quantity: 10 },
  ];
  const orders30d = [
    { goods_name: 'Z', goods_quantity: 1 },
  ];
  const r = scoreInventoryHealth({ goods, orders30d });
  assert.equal(r.detail.matched_by, 'goods_name');
  assert.equal(r.detail.stale_count, 0);
  assert.equal(r.detail.ambiguous_groups.length, 1);
  assert.equal(r.detail.ambiguous_groups[0].normalized_name, 'T恤');
  assert.equal(r.detail.ambiguous_groups[0].sku_count, 2);
  assert.deepEqual(r.detail.ambiguous_groups[0].sample_quantities, [50, 20]);
  assert.ok(r.hints.some((h) => h.includes('重名')));
});

test('scoreInventoryHealth: ambiguous suppressed on goods_id path (id is globally unique)', () => {
  const goods = [
    { goods_id: 11, goods_name: 'T恤', quantity: 50 },
    { goods_id: 12, goods_name: 'T恤', quantity: 20 },
  ];
  const orders30d = [
    { goods_id: 11, goods_name: 'T恤', goods_quantity: 1 },
  ];
  const r = scoreInventoryHealth({ goods, orders30d });
  assert.equal(r.detail.matched_by, 'goods_id');
  assert.deepEqual(r.detail.ambiguous_groups, []);
  assert.equal(r.detail.stale_count, 1);
  assert.equal(r.detail.stale_sample[0].goods_name, 'T恤');
  assert.equal(r.detail.stale_sample[0].quantity, 20);
});

test('scoreInventoryHealth: truncated=true skips stale (stale_count=null)', () => {
  const goods = [
    { goods_id: 1, goods_name: 'A', quantity: 100 },
    { goods_id: 2, goods_name: 'B', quantity: 50 },
  ];
  const r = scoreInventoryHealth({ goods, orders30d: [], truncated: true });
  assert.equal(r.detail.stale_count, null);
  assert.equal(r.detail.stale_sample, null);
  assert.equal(r.detail.truncated, true);
  assert.ok(r.hints.some((h) => h.includes('30 天订单量超出扫描上限')));
  // stock-level scoring 仍计算
  assert.equal(r.detail.total, 2);
  assert.equal(r.detail.out_of_stock, 0);
});

test('scoreInventoryHealth: ratelimited=true skips stale with dedicated hint', () => {
  const goods = [{ goods_id: 1, goods_name: 'A', quantity: 100 }];
  const r = scoreInventoryHealth({ goods, orders30d: [], ratelimited: true });
  assert.equal(r.detail.stale_count, null);
  assert.equal(r.detail.matched_by, null);
  assert.ok(r.hints.some((h) => h.includes('限流')));
});

test('scoreInventoryHealth: missing orders30d → hint about missing data', () => {
  const goods = [{ goods_id: 1, goods_name: 'A', quantity: 100 }];
  const r = scoreInventoryHealth({ goods });
  assert.equal(r.detail.stale_count, null);
  assert.ok(r.hints.some((h) => h.includes('未提供')));
});

test('scoreInventoryHealth: goods_name normalize tolerates whitespace + full-width', () => {
  const goods = [
    { goods_name: '  冬季羽绒服  ', quantity: 100 },
    { goods_name: 'ＡＢＣ', quantity: 50 }, // 全角
  ];
  const orders30d = [
    { goods_name: '冬季羽绒服', goods_quantity: 2 },
    { goods_name: 'ABC', goods_quantity: 1 }, // 半角
  ];
  const r = scoreInventoryHealth({ goods, orders30d });
  assert.equal(r.detail.matched_by, 'goods_name');
  assert.equal(r.detail.stale_count, 0);
});

test('scoreInventoryHealth: mixed goods_id presence → matched_by="mixed" + fallback to goods_name', () => {
  // 生产环境常见：orders.list 有 goods_id，goods.list 的 goods_id 全 null
  // 对策：global strategy 降级 goods_name，让交叉匹配仍然生效；matched_by="mixed" 标记降级
  const goods = [
    { goods_id: 1, goods_name: 'A', quantity: 100 },
    { goods_id: 2, goods_name: 'B', quantity: 50 },
  ];
  const orders30d = [
    // 订单完全没有 goods_id
    { goods_name: 'A', goods_quantity: 1 },
  ];
  const r = scoreInventoryHealth({ goods, orders30d });
  assert.equal(r.detail.matched_by, 'mixed');
  // 降级 goods_name 路径后 A 能被订单 credit，只有 B stale
  assert.equal(r.detail.stale_count, 1);
  assert.equal(r.detail.stale_sample[0].goods_name, 'B');
});

test('scoreInventoryHealth: nested order.items shape extracted correctly', () => {
  const goods = [
    { goods_id: 1, goods_name: 'A', quantity: 100 },
    { goods_id: 2, goods_name: 'B', quantity: 50 },
  ];
  const orders30d = [
    { items: [{ goods_id: 1, goods_name: 'A', quantity: 4 }, { goods_id: 2, goods_name: 'B', quantity: 1 }] },
  ];
  const r = scoreInventoryHealth({ goods, orders30d });
  assert.equal(r.detail.stale_count, 0);
});

test('scoreInventoryHealth: combined stock + stale issues', () => {
  const goods = [
    { goods_id: 1, goods_name: 'A', quantity: 0 },     // 缺货
    { goods_id: 2, goods_name: 'B', quantity: 0 },     // 缺货
    { goods_id: 3, goods_name: 'C', quantity: 100 },   // 滞销
    { goods_id: 4, goods_name: 'D', quantity: 100 },   // 滞销
    { goods_id: 5, goods_name: 'E', quantity: 100 },   // 滞销
  ];
  const orders30d = []; // 没有任何销售
  const r = scoreInventoryHealth({ goods, orders30d });
  assert.equal(r.detail.stale_count, 3);
  assert.equal(r.detail.out_of_stock, 2);
  // issues 应同时包含缺货与滞销
  const issueText = r.issues.join('|');
  assert.ok(issueText.includes('缺货'));
  assert.ok(issueText.includes('疑似滞销'));
});

test('scoreInventoryHealth: goodsTotal>goods.length → emits truncation hint', () => {
  const goods = [{ goods_id: 1, goods_name: 'A', quantity: 100 }];
  const r = scoreInventoryHealth({ goods, orders30d: [], goodsTotal: 250 });
  assert.equal(r.detail.total, 1);
  assert.equal(r.detail.total_reported, 250);
  assert.ok(r.hints.some((h) => h.includes('仅分析前 1 件商品') && h.includes('250')));
});

test('scoreInventoryHealth: numeric + string goods_id normalize to same key', () => {
  // 同 ID 不同类型（order 用 number，inventory 用 string）应正确匹配
  const goods = [
    { goods_id: '1001', goods_name: 'A', quantity: 100 },
    { goods_id: '1002', goods_name: 'B', quantity: 50 },
  ];
  const orders30d = [
    { goods_id: 1001, goods_name: 'A', goods_quantity: 3 },
  ];
  const r = scoreInventoryHealth({ goods, orders30d });
  assert.equal(r.detail.matched_by, 'goods_id');
  // A 被售出（跨类型匹配），B 未售出 → stale
  assert.equal(r.detail.stale_count, 1);
  assert.equal(r.detail.stale_sample[0].goods_name, 'B');
});

test('scoreInventoryHealth: production scenario — orders have id, goods miss id → global fallback to name matches correctly', () => {
  // 镜像真实 PDD 数据：orders.list 返回 goods_id: number，goods.list 返回 goods_id: null
  // Global strategy 降级到 goods_name，仍能正确 credit 卖出的 SKU
  const goods = [
    { goods_id: null, goods_name: '夏季T恤', quantity: 100 }, // 无 id，有销量
    { goods_id: null, goods_name: '冬季羽绒服', quantity: 50 }, // 无 id，无销量
  ];
  const orders30d = [
    { goods_id: 732191698596, goods_name: '夏季T恤', goods_quantity: 2 },
  ];
  const r = scoreInventoryHealth({ goods, orders30d });
  assert.equal(r.detail.matched_by, 'mixed');
  assert.equal(r.detail.stale_count, 1);
  assert.equal(r.detail.stale_sample[0].goods_name, '冬季羽绒服');
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

test('scorePromoHealth: backward-compatible with totals-only input', () => {
  const r = scorePromoHealth({
    totals: { impression: 5000, click: 200, gmv: 1000, spend: 100 },
  });
  assert.equal(r.score, 100);
  assert.equal(r.detail.waste_plan_count, null);
  assert.equal(r.detail.per_plan_roi_available, false);
});

test('scorePromoHealth: entities exposes waste_plan_count', () => {
  const r = scorePromoHealth({
    totals: { impression: 5000, click: 200, gmv: 1000, spend: 100 },
    entities: [
      { spend: 500, gmv: 100 },
      { spend: 200, gmv: 1000 },
    ],
  });
  assert.equal(r.detail.waste_plan_count, 1);
  assert.equal(r.detail.waste_spend, 500);
  assert.equal(r.detail.per_plan_roi_available, true);
});

test('scorePromoHealth: roiAnalysis overrides entities for waste_plan_count', () => {
  const r = scorePromoHealth({
    totals: { impression: 5000, click: 200, gmv: 1000, spend: 100 },
    roiAnalysis: {
      summary: { waste_count: 3, waste_spend: 2000 },
    },
  });
  assert.equal(r.detail.waste_plan_count, 3);
  assert.equal(r.detail.waste_spend, 2000);
  assert.equal(r.detail.per_plan_roi_available, true);
});

// ---------- scoreFunnelHealth (order fulfillment funnel) ----------

test('scoreFunnelHealth: no orderStats → partial', () => {
  const r = scoreFunnelHealth({});
  assert.equal(r.score, null);
  assert.equal(r.status, 'partial');
});

test('scoreFunnelHealth: total=0 → partial', () => {
  const r = scoreFunnelHealth({ orderStats: { total: 0, refund_count: 0, refund_rate: 0 } });
  assert.equal(r.score, null);
  assert.equal(r.status, 'partial');
});

test('scoreFunnelHealth: low refund → green', () => {
  const r = scoreFunnelHealth({
    orderStats: { total: 1000, refund_count: 20, refund_rate: 0.02, status_distribution: {} },
    windowDays: 30,
  });
  assert.equal(r.score, 100);
  assert.equal(r.status, 'green');
  assert.equal(r.detail.total_orders, 1000);
  assert.equal(r.detail.refund_count, 20);
  assert.equal(r.detail.fulfillment_rate, 0.98);
  assert.equal(r.detail.window_days, 30);
});

test('scoreFunnelHealth: boundary refund=0.05 exact → green (strict >)', () => {
  const r = scoreFunnelHealth({
    orderStats: { total: 1000, refund_count: 50, refund_rate: 0.05 },
  });
  assert.equal(r.score, 100);
  assert.equal(r.status, 'green');
});

test('scoreFunnelHealth: mid refund 0.08 → yellow', () => {
  const r = scoreFunnelHealth({
    orderStats: { total: 1000, refund_count: 80, refund_rate: 0.08 },
  });
  assert.equal(r.score, 70);
  assert.equal(r.status, 'yellow');
});

test('scoreFunnelHealth: boundary refund=0.15 exact → yellow (strict >)', () => {
  const r = scoreFunnelHealth({
    orderStats: { total: 1000, refund_count: 150, refund_rate: 0.15 },
  });
  assert.equal(r.score, 70);
  assert.equal(r.status, 'yellow');
});

test('scoreFunnelHealth: high refund 0.20 → red', () => {
  const r = scoreFunnelHealth({
    orderStats: { total: 1000, refund_count: 200, refund_rate: 0.20 },
  });
  assert.equal(r.score, 40);
  assert.equal(r.status, 'red');
  assert.ok(r.issues.length >= 1);
});

test('scoreFunnelHealth: windowDays pass-through', () => {
  const r = scoreFunnelHealth({
    orderStats: { total: 10, refund_count: 0, refund_rate: 0 },
    windowDays: 7,
  });
  assert.equal(r.detail.window_days, 7);
});

// ---------- diagnoseShop (composite) ----------

test('diagnoseShop: returns null score when no dimensions provided', () => {
  const r = diagnoseShop({});
  assert.equal(r.score, null);
  assert.equal(r.status, 'partial');
  assert.equal(r.weight_used, 0);
});

test('diagnoseShop: uses WEIGHTS 0.35/0.20/0.30/0.15', () => {
  assert.equal(WEIGHTS.orders, 0.35);
  assert.equal(WEIGHTS.inventory, 0.20);
  assert.equal(WEIGHTS.promo, 0.30);
  assert.equal(WEIGHTS.funnel, 0.15);
});

test('diagnoseShop: partial dimensions contribute only their weight', () => {
  const r = diagnoseShop({
    orders: { stats: { unship: 5, delay: 0 }, listStats: { shipping_seconds: { p95: 3600 * 10 }, refund_rate: 0.02 } },
    // inventory / promo / funnel undefined → excluded
  });
  // only orders (100) with weight 0.35 → weighted avg = 100
  assert.equal(r.score, 100);
  assert.equal(r.status, 'green');
  assert.equal(r.weight_used, 0.35);
});

test('diagnoseShop: aggregates issues and hints across dimensions', () => {
  const r = diagnoseShop({
    orders: { stats: { unship: 5, delay: 3 }, listStats: {} },
    goods: { goods: [{ quantity: 0 }, { quantity: 0 }, ...Array.from({ length: 18 }, () => ({ quantity: 100 }))] },
  });
  // expect orders issue (delay) AND inventory issue (out-of-stock)
  const dims = new Set(r.issues.map((i) => i.dimension));
  assert.ok(dims.has('orders'));
  assert.ok(dims.has('inventory'));
  const invIssues = r.issues.filter((i) => i.dimension === 'inventory').map((i) => i.message).join('|');
  assert.ok(invIssues.includes('缺货'), `expected inventory 缺货 issue, got: ${invIssues}`);
});
