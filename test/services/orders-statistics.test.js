import assert from 'node:assert/strict';
import { it } from 'vitest';
import { computeOrderStats } from '../../src/services/orders.js';

it('keeps empty shipping statistics unknown while an empty order total and refund count are zero', () => {
  assert.deepEqual(computeOrderStats([]), {
    total: 0, status_distribution: {}, shipping_seconds: { samples: 0, p50: null, p95: null },
    refund_rate: null, refund_count: 0, after_sales_count: 0,
  });
});

it('aggregates mixed field spellings and interpolated shipping times without mutation', () => {
  const orders = [
    { order_status: 1, order_status_str: '已发货，待收货', order_time: 100, ship_time: 3700, after_sales_status: null },
    { orderStatus: 2, orderTime: 100, shipping_time: 10900, after_sales_status: 10 },
    { order_time: 100, ship_time: 50, after_sales_status: 5 },
    { order_status_str: '已发货，待收货', order_time: '100', ship_time: '200' },
  ];
  const before = structuredClone(orders);
  const result = computeOrderStats(orders);
  // 键为上游中文标签；无标签时回退 '未知(<code>)'，两者皆无归入 '未知'
  assert.deepEqual(result.status_distribution, { '已发货，待收货': 2, '未知(2)': 1, 未知: 1 });
  assert.equal(result.total, 4);
  assert.deepEqual(result.shipping_seconds, { samples: 2, p50: 7200, p95: 10440 });
  assert.equal(result.refund_count, 1);
  assert.equal(result.after_sales_count, 1);
  assert.equal(result.refund_rate, 0.25);
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

it('counts refunds and open after-sales only from after_sales_status (real upstream shape)', () => {
  // research order-list-filters-2026-10-08 §3：null = 无售后，5 = 退款成功，10 / 11 = 售后处理中
  const result = computeOrderStats([
    { order_status_str: '已发货，待收货', after_sales_status: null },
    { order_status_str: '已发货，待收货', after_sales_status: null },
    { order_status_str: '已发货，退款成功', after_sales_status: 5 },
    { order_status_str: '未发货，退款成功', after_sales_status: 5 },
    { order_status_str: '已发货，待收货', after_sales_status: 10 },
    { order_status_str: '已发货，待收货', after_sales_status: 11 },
    { order_status_str: '已取消', after_sales_status: null },
    { order_status_str: '已收货', after_sales_status: '5' },
  ]);
  assert.equal(result.total, 8);
  assert.equal(result.refund_count, 3);
  assert.equal(result.after_sales_count, 2);
  assert.equal(result.refund_rate, 3 / 8);
});

it('treats an all-null after_sales_status sample as a known zero', () => {
  const result = computeOrderStats([{ after_sales_status: null }, { after_sales_status: null }]);
  assert.equal(result.refund_count, 0);
  assert.equal(result.after_sales_count, 0);
  assert.equal(result.refund_rate, 0);
});

it('reports refunds as unknown (null) when no order carries the after_sales_status field', () => {
  // 旧版依赖的 refund_status / refundStatus / after_sale_type / afterSaleType 在真实数据中不存在，不得被读取
  const result = computeOrderStats([
    { order_status_str: '已发货，待收货', refund_status: true },
    { refundStatus: 1, after_sale_type: 2, afterSaleType: 2 },
    { order_status_str: '已收货' },
  ]);
  assert.equal(result.total, 3);
  assert.equal(result.refund_count, null);
  assert.equal(result.after_sales_count, null);
  assert.equal(result.refund_rate, null);
});
