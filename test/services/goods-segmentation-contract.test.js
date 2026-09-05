import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { segmentGoods } from '../../src/services/goods-segmentation.js';
import { SAMPLE_SEGMENTATION_INPUT } from '../fixtures/test-data.js';

describe('goods sales and inventory facts', () => {
  it('sums flat and nested items by identity and calculates stock days', () => {
    const result = segmentGoods(structuredClone(SAMPLE_SEGMENTATION_INPUT), { windowDays: 30 });
    const tea = result.items.find((item) => item.goods_id === '101');
    const cup = result.items.find((item) => item.goods_id === '202');
    assert.equal(tea.units_sold_30d, 6);
    assert.equal(tea.observed_units_sold, 6);
    assert.equal(tea.stock_days, 60);
    assert.equal(cup.units_sold_30d, 3);
    assert.equal(cup.quantity, 0);
    assert.equal(cup.stock_days, 0);
    assert.equal(result.summary.matched_by, 'goods_id');
    assert.equal(result.summary.total_goods, 2);
  });

  it('uses the requested sales window for stock-day calculations', () => {
    const result = segmentGoods(structuredClone(SAMPLE_SEGMENTATION_INPUT), { windowDays: 7 });
    assert.equal(result.window_days, 7);
    assert.equal(result.items[0].stock_days, 14);
  });

  it('distinguishes a complete zero-sales period from unknown sales', () => {
    const complete = segmentGoods({ ...structuredClone(SAMPLE_SEGMENTATION_INPUT), orders30d: [] });
    assert.equal(complete.items[0].units_sold_30d, 0);
    assert.equal(complete.items[0].observed_units_sold, 0);
    assert.equal(complete.items[0].stock_days, null);
    assert.equal(complete.summary.data_completeness, 'no_orders');
    assert.equal(complete.summary.data_quality.orders_complete, true);
    const missing = segmentGoods({ ...structuredClone(SAMPLE_SEGMENTATION_INPUT), orders30d: undefined });
    assert.equal(missing.items[0].units_sold_30d, null);
    assert.equal(missing.items[0].observed_units_sold, 0);
    assert.equal(missing.items[0].stock_days, null);
    assert.equal(missing.summary.data_quality.orders_complete, false);
  });

  it.each([
    ['truncation', { truncated: true }, 'orders_truncated'],
    ['rate limit', { ratelimited: true }, 'orders_ratelimited'],
  ])('retains observed sales but not full-period estimates after order %s', (_label, flags, flag) => {
    const result = segmentGoods({ ...structuredClone(SAMPLE_SEGMENTATION_INPUT), ...flags });
    assert.equal(result.items[0].units_sold_30d, null);
    assert.equal(result.items[0].observed_units_sold, 6);
    assert.equal(result.items[0].stock_days, null);
    assert.equal(result.summary.data_completeness, 'partial_orders');
    assert.equal(result.summary.data_quality[flag], true);
    assert.equal(result.summary.data_quality.goods_complete, true);
    assert.ok(result.warnings.length > 0);
  });

  it.each([
    ['truncation', { goodsScanTruncated: true }],
    ['rate limit', { goodsScanRateLimited: true }],
    ['reported total', { goodsTotal: 3 }],
  ])('marks goods %s independently from a complete order scan', (_label, flags) => {
    const result = segmentGoods({ ...structuredClone(SAMPLE_SEGMENTATION_INPUT), ...flags });
    assert.equal(result.summary.data_completeness, 'partial_goods');
    assert.equal(result.summary.data_quality.goods_complete, false);
    assert.equal(result.summary.data_quality.orders_complete, true);
    assert.equal(result.items[0].units_sold_30d, 6);
    assert.equal(result.items[0].stock_days, 60);
  });

  it('retains both source failures instead of one overwriting the other', () => {
    const result = segmentGoods({ ...structuredClone(SAMPLE_SEGMENTATION_INPUT), goodsScanTruncated: true, ratelimited: true });
    assert.equal(result.summary.data_completeness, 'partial_goods_orders');
    assert.equal(result.summary.data_quality.goods_complete, false);
    assert.equal(result.summary.data_quality.orders_complete, false);
    assert.equal(result.summary.data_quality.goods_truncated, true);
    assert.equal(result.summary.data_quality.orders_ratelimited, true);
    assert.equal(result.items[0].observed_units_sold, 6);
  });

  it('reports an empty catalog without treating a truncated empty sample as complete', () => {
    const empty = segmentGoods({ goods: [], orders30d: [] });
    assert.deepEqual(empty.items, []);
    assert.equal(empty.summary.total_goods, 0);
    assert.equal(empty.summary.data_completeness, 'empty');
    const partial = segmentGoods({ goods: [], orders30d: [], goodsTotal: 10 });
    assert.equal(partial.summary.data_completeness, 'partial');
    assert.equal(partial.summary.data_quality.goods_complete, false);
  });

  it('falls back to normalized names when only one source has ids', () => {
    const result = segmentGoods({
      goods: [{ goods_id: null, goods_name: ' Tea ', quantity: 10 }],
      orders30d: [{ goods_id: '101', goods_name: '\uff34\uff45\uff41', quantity: 5 }],
    });
    assert.equal(result.summary.matched_by, 'mixed');
    assert.equal(result.items[0].units_sold_30d, 5);
    assert.equal(result.items[0].stock_days, 60);
  });

  it('excludes ambiguous same-name goods instead of duplicating or arbitrarily allocating sales', () => {
    const result = segmentGoods({
      goods: [{ goods_name: ' Tea', quantity: 3 }, { goods_name: 'Tea ', quantity: 5 }, { goods_name: 'Cup', quantity: 2 }],
      orders30d: [{ goods_name: 'Tea', quantity: 10 }, { goods_name: 'Cup', quantity: 1 }],
    });
    assert.equal(result.summary.matched_by, 'goods_name');
    assert.equal(result.summary.ambiguous_groups, 1);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].goods_name, 'Cup');
    assert.equal(result.items[0].units_sold_30d, 1);
    assert.ok(result.warnings.length > 0);
  });

  it('associates numerical promo ROI by id or by normalized name', () => {
    const result = segmentGoods({ ...structuredClone(SAMPLE_SEGMENTATION_INPUT), promoRoi: { rows: [
      { goods_id: 101, roi: 1.25 }, { goods_name: ' Cup ', roi: 0 },
    ] } });
    assert.equal(result.items[0].promo_roi, 1.25);
    assert.equal(result.items[1].promo_roi, 0);
    assert.equal(result.summary.data_completeness, 'full');
  });
});
