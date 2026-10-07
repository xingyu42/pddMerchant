import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  summarizeOrders, summarizeInventory, summarizePromo, summarizeFunnel, diagnoseShop,
} from '../../src/services/diagnose/index.js';
import { compareShopDiagnosis, resolveCompareWindows } from '../../src/services/diagnose/trend-compare.js';
import { SAMPLE_LIST_STATS, SAMPLE_GOODS } from '../fixtures/test-data.js';

describe('diagnostic source availability and facts', () => {
  it('reports absent order sources separately and preserves available counters', () => {
    const empty = summarizeOrders();
    assert.equal(empty.status, 'partial');
    assert.deepEqual(empty.detail, {});
    assert.ok(empty.issues.length > 0);
    const countersOnly = summarizeOrders({ stats: { unship: 0, delay: 2 } });
    assert.equal(countersOnly.status, 'partial');
    assert.equal(countersOnly.detail.pending_ship_count, 0);
    assert.equal(countersOnly.detail.delayed_ship_count, 2);
    assert.equal(countersOnly.detail.shipping_p95_hours, null);
    assert.ok(countersOnly.hints.length > 0);
    const listOnly = summarizeOrders({ listStats: structuredClone(SAMPLE_LIST_STATS) });
    assert.equal(listOnly.status, 'partial');
    assert.equal(listOnly.detail.shipping_p95_hours, 10);
    assert.ok(listOnly.hints.length > 0);
  });

  it('converts shipping seconds to hours and refund ratios to percentages with both order sources present', () => {
    const result = summarizeOrders({ stats: { unship: 0, delay: 0 }, listStats: { ...structuredClone(SAMPLE_LIST_STATS), refund_rate: 0.123456 } });
    assert.equal(result.status, 'full');
    assert.equal(result.detail.shipping_p95_hours, 10);
    assert.equal(result.detail.refund_rate_pct, 12.35);
    assert.equal(result.detail.pending_ship_count, 0);
  });

  it('calculates inventory threshold boundaries and zero-sales counts from complete sources', () => {
    const result = summarizeInventory({ goods: structuredClone(SAMPLE_GOODS), orders30d: [{ goods_id: 202, goods_name: 'Cup', quantity: 2 }] });
    assert.equal(result.status, 'full');
    assert.equal(result.detail.total, 4);
    assert.equal(result.detail.out_of_stock_count, 1);
    assert.equal(result.detail.low_stock_count, 1);
    assert.equal(result.detail.out_of_stock_rate_pct, 25);
    assert.equal(result.detail.low_or_out_rate_pct, 50);
    assert.equal(result.detail.stale_count, 2);
    assert.deepEqual(result.detail.stale_sample, [
      { goods_id: '303', goods_name: 'Plate', quantity: 10 },
      { goods_id: '404', goods_name: 'Bag', quantity: 15 },
    ]);
  });

  it('distinguishes unavailable goods from a genuinely empty inventory', () => {
    const missing = summarizeInventory({ orders30d: [] });
    assert.equal(missing.status, 'partial');
    assert.equal(missing.detail.data_quality.goods_complete, false);
    assert.ok(missing.issues.length > 0);
    const empty = summarizeInventory({ goods: [], orders30d: [] });
    assert.equal(empty.status, 'full');
    assert.equal(empty.detail.total, 0);
    assert.equal(empty.detail.stale_count, 0);
    assert.equal(empty.detail.out_of_stock_rate_pct, null);
  });

  it.each([
    ['missing', { orders30d: undefined }],
    ['truncated', { orders30d: [], truncated: true }],
    ['limited', { orders30d: [], ratelimited: true }],
  ])('keeps zero-sales inventory counts unknown when orders are %s', (_label, flags) => {
    const result = summarizeInventory({ goods: structuredClone(SAMPLE_GOODS), ...flags });
    assert.equal(result.status, 'partial');
    assert.equal(result.detail.total, 4);
    assert.equal(result.detail.stale_count, null);
    assert.equal(result.detail.stale_sample, null);
    assert.equal(result.detail.data_quality.orders_complete, false);
    assert.equal(result.detail.data_quality.goods_complete, true);
    assert.ok(result.hints.length > 0);
  });

  it.each([{ goodsTotal: 8 }, { goodsScanTruncated: true }, { goodsScanRateLimited: true }])('preserves independently incomplete goods scans %#', (flags) => {
    const result = summarizeInventory({ goods: structuredClone(SAMPLE_GOODS), orders30d: [], ...flags });
    assert.equal(result.status, 'partial');
    assert.equal(result.detail.total, 4);
    assert.equal(result.detail.data_quality.goods_complete, false);
    assert.equal(result.detail.data_quality.orders_complete, true);
    if (flags.goodsTotal) assert.equal(result.detail.reported_total, 8);
  });

  it('does not count ambiguous same-name inventory as confirmed zero-sales goods', () => {
    const result = summarizeInventory({
      goods: [{ goods_name: 'Tea', quantity: 2 }, { goods_name: ' Tea ', quantity: 4 }], orders30d: [],
    });
    assert.equal(result.detail.stale_count, 0);
    assert.equal(result.detail.ambiguous_groups.length, 1);
    assert.equal(result.detail.ambiguous_groups[0].sku_count, 2);
    assert.ok(result.hints.length > 0);
  });

  it('distinguishes missing promotion spend from known zero spend', () => {
    const missing = summarizePromo({ totals: { impression: 100, click: 10, gmv: 0 } });
    assert.equal(missing.status, 'partial');
    assert.equal(missing.detail.spend_yuan, null);
    assert.equal(missing.detail.roi, null);
    assert.ok(missing.hints.length > 0);
    const zero = summarizePromo({ totals: { impression: 0, click: 0, gmv: 0, spend: 0 } });
    assert.equal(zero.status, 'full');
    assert.equal(zero.detail.spend_yuan, 0);
    assert.equal(zero.detail.roi, null);
    assert.equal(zero.detail.ctr_pct, null);
    assert.equal(summarizePromo().status, 'partial');
  });

  it.each([{ spend: 100 }, { cost: 100 }, { goodsFavSpend: 30, mallFavSpend: 20, inquirySpend: 50 }])('calculates promo metrics from the supported spend source %#', (spend) => {
    const result = summarizePromo({ totals: { impression: 3, click: 1, gmv: 125, ...spend } });
    assert.equal(result.status, 'full');
    assert.equal(result.detail.spend_yuan, 100);
    assert.equal(result.detail.gmv_yuan, 125);
    assert.equal(result.detail.roi, 1.25);
    assert.equal(result.detail.ctr_pct, 33.33);
  });

  it('keeps absent funnel data partial and a zero-order denominator undefined', () => {
    assert.equal(summarizeFunnel().status, 'partial');
    assert.equal(summarizeFunnel({ orderStats: { total: '4' } }).status, 'partial');
    const empty = summarizeFunnel({ orderStats: { total: 0, refund_count: 0, refund_rate: 0 } });
    assert.equal(empty.status, 'full');
    assert.equal(empty.detail.total_orders, 0);
    assert.equal(empty.detail.fulfillment_rate_pct, null);
    assert.equal(empty.detail.refund_rate_pct, null);
    const complete = summarizeFunnel({ orderStats: structuredClone(SAMPLE_LIST_STATS), windowDays: 7 });
    assert.equal(complete.detail.fulfillment_rate_pct, 75);
    assert.equal(complete.detail.refund_rate_pct, 25);
    assert.equal(complete.detail.refund_count, 1);
    assert.equal(complete.detail.window_days, 7);
    assert.deepEqual(complete.detail.status_distribution, { '已发货，待收货': 4 });
  });

  it('propagates unknown refund counts to funnel and orders rates instead of assuming zero', () => {
    const unknown = { ...structuredClone(SAMPLE_LIST_STATS), refund_count: null, refund_rate: null };
    const funnel = summarizeFunnel({ orderStats: unknown, windowDays: 7 });
    assert.equal(funnel.detail.total_orders, 4);
    assert.equal(funnel.detail.refund_count, null);
    assert.equal(funnel.detail.refund_rate_pct, null);
    assert.equal(funnel.detail.fulfillment_rate_pct, null);
    assert.ok(funnel.hints.some((hint) => hint.includes('退款数据不可用')));
    const orders = summarizeOrders({ stats: { unship: 0, delay: 0 }, listStats: unknown });
    assert.equal(orders.detail.refund_rate_pct, null);
    assert.ok(orders.hints.some((hint) => hint.includes('退款数据不可用')));
  });

  it('requires every source for a full shop summary and attributes missing-source hints', () => {
    const input = {
      orders: { stats: { unship: 0, delay: 0 }, listStats: structuredClone(SAMPLE_LIST_STATS) },
      goods: { goods: structuredClone(SAMPLE_GOODS), orders30d: [] },
      promo: { totals: { spend: 100, gmv: 50 } },
      funnel: { orderStats: structuredClone(SAMPLE_LIST_STATS) },
    };
    assert.equal(diagnoseShop(input).status, 'full');
    const partial = diagnoseShop({ ...input, promo: undefined });
    assert.equal(partial.status, 'partial');
    assert.equal(partial.dimensions.orders.status, 'full');
    assert.equal(partial.dimensions.promo.status, 'partial');
    assert.ok(partial.issues.some((issue) => issue.dimension === 'promo'));
    assert.ok(partial.hints.some((hint) => hint.dimension === 'promo'));
  });
});

describe('numeric window comparisons', () => {
  it('uses adjacent non-overlapping windows with an explicit clock', () => {
    assert.deepEqual(resolveCompareWindows({ nowSec: 1700000000, days: 7 }), {
      current: { since: 1699395200, until: 1700000000, days: 7 },
      previous: { since: 1698790400, until: 1699395200, days: 7 },
    });
  });

  it('compares numbers while leaving snapshots, missing priors and zero denominators uncomparable', () => {
    const input = {
      current: { dimensions: {
        orders: { detail: { shipping_p95_hours: 10, pending_ship_count: 5, delayed_ship_count: 2 } },
        inventory: { detail: { total: 4, low_stock_count: 1 } },
        promo: { detail: { spend_yuan: 120, roi: 1.25 } },
        funnel: { detail: { total_orders: 20 } },
      } },
      previous: { dimensions: {
        orders: { detail: { shipping_p95_hours: 20, pending_ship_count: 3, delayed_ship_count: 1 } },
        inventory: { detail: { total: 3, low_stock_count: 0 } },
        promo: { detail: { spend_yuan: 100, roi: 0 } },
        funnel: { detail: { total_orders: null } },
      } },
    };
    const before = structuredClone(input);
    const { dimensions } = compareShopDiagnosis(input);
    assert.deepEqual(dimensions.orders.metrics.shipping_p95_hours, { current: 10, previous: 20, delta: -10, delta_pct: -50 });
    assert.deepEqual(dimensions.promo.metrics.spend_yuan, { current: 120, previous: 100, delta: 20, delta_pct: 20 });
    assert.deepEqual(dimensions.promo.metrics.roi, { current: 1.25, previous: 0, delta: 1.25, delta_pct: null });
    assert.deepEqual(dimensions.funnel.metrics.total_orders, { current: 20, previous: null, delta: null, delta_pct: null });
    for (const metric of [dimensions.orders.metrics.pending_ship_count, dimensions.orders.metrics.delayed_ship_count, ...Object.values(dimensions.inventory.metrics)]) {
      assert.equal(metric.previous, null);
      assert.equal(metric.delta, null);
      assert.equal(metric.delta_pct, null);
      assert.equal(metric.note, 'current_snapshot_only');
    }
    assert.equal(dimensions.orders.metrics.pending_ship_count.current, 5);
    assert.deepEqual(input, before);
  });

  it('handles a missing current window and a missing previous window without manufacturing zeroes', () => {
    assert.equal(compareShopDiagnosis({ previous: { dimensions: {} } }), null);
    const current = { dimensions: { promo: { detail: { spend_yuan: 10 } } } };
    const metric = compareShopDiagnosis({ current }).dimensions.promo.metrics.spend_yuan;
    assert.deepEqual(metric, { current: 10, previous: null, delta: null, delta_pct: null });
  });
});
