import assert from 'node:assert/strict';
import { it } from 'vitest';
import { computeOrderStats } from '../../src/services/orders.js';

it('keeps empty shipping statistics unknown while an empty order total is zero', () => {
  assert.deepEqual(computeOrderStats([]), {
    total: 0, status_distribution: {}, shipping_seconds: { samples: 0, p50: null, p95: null },
    refund_rate: 0, refund_count: 0,
  });
});

it('aggregates mixed field spellings, refunds and interpolated shipping times without mutation', () => {
  const orders = [
    { order_status: 1, order_status_str: '已发货，待收货', order_time: 100, ship_time: 3700, refund_status: false },
    { orderStatus: 2, orderTime: 100, shipping_time: 10900, afterSaleType: 2 },
    { order_time: 100, ship_time: 50, refund_status: true },
    { order_status_str: '已发货，待收货', order_time: '100', ship_time: '200' },
  ];
  const before = structuredClone(orders);
  const result = computeOrderStats(orders);
  // 键为上游中文标签；无标签时回退 '未知(<code>)'，两者皆无归入 '未知'
  assert.deepEqual(result.status_distribution, { '已发货，待收货': 2, '未知(2)': 1, 未知: 1 });
  assert.equal(result.total, 4);
  assert.deepEqual(result.shipping_seconds, { samples: 2, p50: 7200, p95: 10440 });
  assert.equal(result.refund_count, 2);
  assert.equal(result.refund_rate, 0.5);
  assert.deepEqual(orders, before);
});

it('uses the only valid shipping sample for both percentiles', () => {
  const result = computeOrderStats([
    { orderTime: 100, shipTime: 160 },
    { orderTime: 100, shipTime: 100 },
    { orderTime: 100 },
  ]);
  assert.deepEqual(result.shipping_seconds, { samples: 1, p50: 60, p95: 60 });
});

it('preserves explicit no-refund flags ahead of fallback after-sale fields', () => {
  const result = computeOrderStats([
    { refund_status: false, afterSaleType: 2 },
    { refundStatus: 0, after_sale_type: 2 },
    { after_sale_type: 1 },
    { after_sale_type: 2 },
  ]);
  assert.equal(result.refund_count, 1);
  assert.equal(result.refund_rate, 0.25);
});
