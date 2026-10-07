import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  ORDER_DETAIL_VIEW_FIELDS, ORDER_VIEW_FIELDS, toLocalOrderStatsView, toOrderDetailView, toOrderView,
  toRemoteOrderStatsView,
} from '../../src/services/views/order.js';
import { computeOrderStats } from '../../src/services/orders.js';
import {
  createUpstreamOrder, createUpstreamOrderDetail, SYNTHETIC_PII_VALUES,
} from '../fixtures/test-data.js';

const EXPECTED_ORDER_VIEW = Object.freeze({
  order_sn: 'SYN-1',
  status: '已发货，待收货',
  goods_id: '101',
  goods_name: 'Tea',
  spec: '默认',
  quantity: 2,
  unit_price_yuan: 12.5,
  goods_amount_yuan: 25,
  merchant_discount_yuan: 1,
  platform_discount_yuan: 0.5,
  shipping_fee_yuan: 0,
  paid_amount_yuan: 23.5,
  ordered_at: '2023-11-15 06:13:20',
  ship_deadline_at: '2023-11-17 06:13:20',
  shipped_at: '2023-11-15 07:13:20',
  express_company: 'SYN 快递',
  tracking_number: 'SYNTRACK001',
  buyer_memo: null,
  after_sales_status: null,
});

describe('order view projection', () => {
  it('projects the upstream list item onto the whitelist with yuan and Shanghai time', () => {
    const view = toOrderView(createUpstreamOrder());
    assert.deepEqual(view, EXPECTED_ORDER_VIEW);
    assert.deepEqual(Object.keys(view), [...ORDER_VIEW_FIELDS]);
  });

  it('ignores unknown upstream fields and never leaks PII', () => {
    const noisy = createUpstreamOrder({
      unknownFlag: 1, orderStatusDesc: 'x', extra: { nested: true }, receiver_phone: 'SYN-EXTRA-PHONE',
    });
    const view = toOrderView(noisy);
    assert.deepEqual(view, EXPECTED_ORDER_VIEW);
    const serialized = JSON.stringify(view);
    for (const value of [...SYNTHETIC_PII_VALUES, 'SYN-EXTRA-PHONE']) assert.equal(serialized.includes(value), false);
  });

  it('keeps every absent field null instead of inventing zero', () => {
    const view = toOrderView({});
    assert.deepEqual(Object.keys(view), [...ORDER_VIEW_FIELDS]);
    for (const [key, value] of Object.entries(view)) assert.equal(value, null, key);
    assert.equal(toOrderView(undefined).order_sn, null);
  });

  it('falls back to an unknown label for status codes and unregistered after-sales codes', () => {
    const view = toOrderView({ order_status: 5, after_sales_status: 3 });
    assert.equal(view.status, '未知(5)');
    assert.equal(view.after_sales_status, '未知(3)');
    assert.equal(toOrderView({ orderSn: 'SYN-CAMEL', orderStatus: 2 }).order_sn, 'SYN-CAMEL');
  });

  it.each([
    [5, '退款成功'],
    [10, '售后处理中'],
    [11, '售后处理中'],
    [99, '未知(99)'],
    [null, null],
  ])('labels after_sales_status %s as %s', (code, label) => {
    assert.equal(toOrderView(createUpstreamOrder({ after_sales_status: code })).after_sales_status, label);
  });

  it('treats zero timestamps as not happened', () => {
    const view = toOrderView(createUpstreamOrder({ shipping_time: 0, promise_shipping_time: 0 }));
    assert.equal(view.shipped_at, null);
    assert.equal(view.ship_deadline_at, null);
  });

  it('adds detail-only facts and reads the detail express company field', () => {
    const view = toOrderDetailView(createUpstreamOrderDetail());
    assert.deepEqual(Object.keys(view), [...ORDER_DETAIL_VIEW_FIELDS]);
    assert.equal(view.order_sn, 'SYN-DETAIL');
    assert.equal(view.express_company, 'SYN 快递');
    assert.equal(view.paid_at, '2023-11-15 06:14:20');
    assert.equal(view.grouped_at, '2023-11-15 06:15:20');
    assert.equal(view.received_at, null);
    assert.equal(view.invoice_status, '未申请');
  });
});

describe('order stats views', () => {
  it('renames remote counters to domain names', () => {
    assert.deepEqual(toRemoteOrderStatsView({ unship: 4, unship12h: 2, delay: 0, unreceive: 22 }), {
      pending_ship_count: 4, pending_ship_over_12h_count: 2, delayed_ship_count: 0, pending_receipt_count: 22,
    });
  });

  it('converts local seconds to hours and ratios to percentages', () => {
    const local = toLocalOrderStatsView(computeOrderStats([
      { order_status_str: '已发货，待收货', order_time: 100, shipping_time: 3700, after_sales_status: 10 },
      { order_status_str: '已发货，退款成功', order_time: 100, shipping_time: 9100, after_sales_status: 5 },
    ]));
    assert.deepEqual(local, {
      order_count: 2,
      status_distribution: { '已发货，待收货': 1, '已发货，退款成功': 1 },
      ship_samples: 2,
      ship_p50_hours: 1.8,
      ship_p95_hours: 2.4,
      refund_count: 1,
      after_sales_count: 1,
      refund_rate_pct: 50,
    });
  });

  it('keeps refund facts null when the sample lacks the after-sales field', () => {
    const local = toLocalOrderStatsView(computeOrderStats([{ order_status_str: '已收货' }]));
    assert.equal(local.order_count, 1);
    assert.equal(local.refund_count, null);
    assert.equal(local.after_sales_count, null);
    assert.equal(local.refund_rate_pct, null);
  });

  it('keeps empty samples unknown rather than zero', () => {
    const local = toLocalOrderStatsView(computeOrderStats([]));
    assert.equal(local.order_count, 0);
    assert.equal(local.ship_p50_hours, null);
    assert.equal(local.ship_p95_hours, null);
    assert.equal(local.refund_rate_pct, null);
    assert.equal(local.refund_count, 0);
  });
});
