import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { runCli } from '../helpers/isolated-cli.js';
import { createFactFixtures } from '../fixtures/test-data.js';

describe('factual reports through the offline CLI', () => {
  it('uses the requested sales window and enriches goods with factual promotion ROI', () => {
    const { status, envelope } = runCli(['goods', 'segment', '--days', '7'], { fixtures: createFactFixtures() });
    assert.equal(status, 0);
    assert.equal(envelope.command, 'goods.segment');
    assert.equal(envelope.data.window_days, 7);
    assert.deepEqual(envelope.data.items, [{
      goods_id: '101', goods_name: 'Tea', units_sold: 2, observed_units_sold: 2,
      quantity: 10, stock_days: 35, promo_roi: 1.25,
    }]);
    assert.equal(envelope.data.summary.data_completeness, '数据完整');
    assert.equal(envelope.data.summary.matched_by, '按商品 ID 匹配');
    assert.equal(envelope.data.summary.data_quality.goods_complete, true);
    assert.equal(envelope.data.summary.data_quality.orders_complete, true);
  });

  it('propagates a capped goods scan without discarding complete order facts', () => {
    const fixtures = createFactFixtures();
    fixtures['endpoints/goods.list.json'].total = 2;
    const { status, envelope } = runCli(['goods', 'segment', '--size', '1', '--max-pages', '1', '--no-promo'], { fixtures });
    assert.equal(status, 0);
    assert.equal(envelope.data.summary.data_completeness, '商品数据不完整');
    assert.equal(envelope.data.summary.data_quality.goods_truncated, true);
    assert.equal(envelope.data.summary.data_quality.orders_complete, true);
    assert.equal(envelope.data.items[0].units_sold, 2);
    assert.equal(envelope.data.items[0].stock_days, 150);
    assert.ok(envelope.meta.warnings.length > 0);
  });

  it('keeps order-dependent metrics unknown after an order scan is rate limited', () => {
    const fixtures = createFactFixtures();
    fixtures['endpoints/orders.list.json'] = { __throws: true, __error: { code: 'E_RATE_LIMIT', exitCode: 4, message: 'Synthetic limit' } };
    const { status, envelope } = runCli(['goods', 'segment', '--no-promo'], { fixtures });
    assert.equal(status, 0);
    assert.equal(envelope.data.summary.data_completeness, '订单数据不完整');
    assert.equal(envelope.data.summary.data_quality.orders_ratelimited, true);
    assert.equal(envelope.data.summary.data_quality.goods_complete, true);
    assert.equal(envelope.data.items[0].observed_units_sold, 0);
    assert.equal(envelope.data.items[0].units_sold, null);
    assert.equal(envelope.data.items[0].stock_days, null);
    assert.ok(envelope.meta.warnings.length > 0);
  });

  it('routes SKU grouping and the explicit inactive inclusion option', () => {
    const fixtures = createFactFixtures();
    fixtures['endpoints/promo.entityReport.json'].entities.push({
      planId: 'p2', adId: 'a2', goodsId: '101', goodsName: 'Tea',
      spend: 50, gmv: 25, impression: 50, click: 5, isDeleted: true,
    });
    const excluded = runCli(['promo', 'roi', '--by', 'sku'], { fixtures });
    assert.equal(excluded.status, 0);
    assert.equal(excluded.envelope.data.by, '商品');
    assert.equal(excluded.envelope.data.summary.excluded_inactive_count, 1);
    assert.equal(excluded.envelope.data.summary.excluded_inactive_spend_yuan, 50);
    assert.equal(excluded.envelope.data.summary.spend_yuan, 100);
    assert.equal(excluded.envelope.data.summary.roi, 1.25);
    assert.deepEqual(excluded.envelope.data.headline, [
      '本页按商品统计 1 项：花费 100.00 元，成交 125.00 元，ROI 1.25',
      '已排除已删除的推广 1 项（花费 50.00 元）',
    ]);
    const included = runCli(['promo', 'roi', '--by', 'sku', '--include-inactive'], { fixtures });
    assert.equal(included.status, 0);
    assert.equal(included.envelope.data.items.length, 1);
    assert.equal(included.envelope.data.total, 1);
    assert.equal(included.envelope.data.items[0].goods_id, '101');
    assert.equal(included.envelope.data.items[0].ctr_pct, 10);
    assert.equal(included.envelope.data.summary.excluded_inactive_count, 0);
    assert.equal(included.envelope.data.summary.spend_yuan, 150);
    assert.equal(included.envelope.data.summary.roi, 1);
    assert.equal(included.envelope.data.totals.spend_yuan, 100);
    assert.equal(included.envelope.data.totals.ctr_pct, 10);
  });

  it('builds a full factual diagnosis from all available sources', () => {
    const { status, envelope } = runCli(['diagnose', 'shop'], { fixtures: createFactFixtures() });
    assert.equal(status, 0);
    assert.equal(envelope.command, 'diagnose.shop');
    assert.equal(envelope.data.status, '数据完整');
    assert.deepEqual(envelope.data.headline, ['4 个维度数据均完整']);
    const { orders, inventory, promo, funnel } = envelope.data.dimensions;
    assert.equal(orders.status, '数据完整');
    assert.equal(orders.detail.pending_ship_count, 1);
    assert.equal(orders.detail.shipping_p95_hours, 1);
    assert.equal(inventory.detail.total, 1);
    assert.equal(inventory.detail.stale_count, 0);
    assert.equal(inventory.detail.matched_by, '按商品 ID 匹配');
    assert.equal(promo.detail.spend_yuan, 100);
    assert.equal(promo.detail.roi, 1.25);
    assert.deepEqual(promo.headline, ['推广花费 100.00 元，成交 125.00 元，ROI 1.25', '曝光 100 次，点击 10 次，点击率 10%']);
    assert.equal(funnel.detail.total_orders, 1);
    assert.equal(funnel.detail.fulfillment_rate_pct, 100);
  });

  it('retains other dimensions and attributes unavailable promotion data', () => {
    const fixtures = createFactFixtures();
    fixtures['endpoints/promo.entityReport.json'] = { __throws: true, __error: { code: 'E_NETWORK', exitCode: 5, message: 'Synthetic unavailable source' } };
    const { status, envelope } = runCli(['diagnose', 'shop'], { fixtures });
    assert.equal(status, 0);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.status, '数据不完整');
    assert.equal(envelope.data.dimensions.orders.status, '数据完整');
    assert.equal(envelope.data.dimensions.inventory.status, '数据完整');
    assert.equal(envelope.data.dimensions.promo.status, '数据不完整');
    assert.deepEqual(envelope.data.headline, ['4 个维度中 3 个数据完整；不完整：推广']);
    assert.ok(envelope.data.issues.some((issue) => issue.dimension === '推广'));
    assert.ok(envelope.data.hints.some((hint) => hint.dimension === '推广'));
  });

  it('routes --compare through the CLI to a comparison report', () => {
    const { status, envelope } = runCli(['diagnose', 'shop', '--compare', '--days', '7'], { fixtures: createFactFixtures() });
    assert.equal(status, 0);
    const { compare } = envelope.data;
    assert.equal(compare.status, '数据完整');
    assert.equal(compare.current_window.days, 7);
    assert.match(compare.current_window.start_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(compare.previous_window.end_date, compare.current_window.start_date);
    assert.equal(compare.dimensions.orders.metrics.pending_ship_count.note, '仅有当前快照，无上期数据');
    assert.match(envelope.data.headline[1], /^对比区间：本期 /);
  });
});
