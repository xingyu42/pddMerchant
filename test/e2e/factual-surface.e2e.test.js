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
      goods_id: '101', goods_name: 'Tea', units_sold_30d: 2, observed_units_sold: 2,
      quantity: 10, stock_days: 35, promo_roi: 1.25,
    }]);
    assert.equal(envelope.data.summary.data_completeness, 'full');
    assert.equal(envelope.data.summary.data_quality.goods_complete, true);
    assert.equal(envelope.data.summary.data_quality.orders_complete, true);
  });

  it('propagates a capped goods scan without discarding complete order facts', () => {
    const fixtures = createFactFixtures();
    fixtures['endpoints/goods.list.json'].total = 2;
    const { status, envelope } = runCli(['goods', 'segment', '--size', '1', '--max-pages', '1', '--no-promo'], { fixtures });
    assert.equal(status, 0);
    assert.equal(envelope.data.summary.data_completeness, 'partial_goods');
    assert.equal(envelope.data.summary.data_quality.goods_truncated, true);
    assert.equal(envelope.data.summary.data_quality.orders_complete, true);
    assert.equal(envelope.data.items[0].units_sold_30d, 2);
    assert.equal(envelope.data.items[0].stock_days, 150);
    assert.ok(envelope.meta.warnings.length > 0);
  });

  it('keeps order-dependent metrics unknown after an order scan is rate limited', () => {
    const fixtures = createFactFixtures();
    fixtures['endpoints/orders.list.json'] = { __throws: true, __error: { code: 'E_RATE_LIMIT', exitCode: 4, message: 'Synthetic limit' } };
    const { status, envelope } = runCli(['goods', 'segment', '--no-promo'], { fixtures });
    assert.equal(status, 0);
    assert.equal(envelope.data.summary.data_completeness, 'partial_orders');
    assert.equal(envelope.data.summary.data_quality.orders_ratelimited, true);
    assert.equal(envelope.data.summary.data_quality.goods_complete, true);
    assert.equal(envelope.data.items[0].observed_units_sold, 0);
    assert.equal(envelope.data.items[0].units_sold_30d, null);
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
    assert.equal(excluded.envelope.data.by, 'sku');
    assert.equal(excluded.envelope.data.summary.excluded_inactive, 1);
    assert.equal(excluded.envelope.data.summary.total_spend, 100);
    assert.equal(excluded.envelope.data.summary.overall_roi, 1.25);
    const included = runCli(['promo', 'roi', '--by', 'sku', '--include-inactive'], { fixtures });
    assert.equal(included.status, 0);
    assert.equal(included.envelope.data.rows.length, 1);
    assert.equal(included.envelope.data.rows[0].goods_id, '101');
    assert.equal(included.envelope.data.rows[0].ctr, 0.1);
    assert.equal(included.envelope.data.summary.excluded_inactive, 0);
    assert.equal(included.envelope.data.summary.total_spend, 150);
    assert.equal(included.envelope.data.summary.overall_roi, 1);
  });

  it('builds a full factual diagnosis from all available sources', () => {
    const { status, envelope } = runCli(['diagnose', 'shop'], { fixtures: createFactFixtures() });
    assert.equal(status, 0);
    assert.equal(envelope.command, 'diagnose.shop');
    assert.equal(envelope.data.status, 'full');
    const { orders, inventory, promo, funnel } = envelope.data.dimensions;
    assert.equal(orders.detail.unship, 1);
    assert.equal(orders.detail.shipping_p95_hours, 1);
    assert.equal(inventory.detail.total, 1);
    assert.equal(inventory.detail.stale_count, 0);
    assert.equal(promo.detail.spend, 100);
    assert.equal(promo.detail.roi, 1.25);
    assert.equal(funnel.detail.total_orders, 1);
    assert.equal(funnel.detail.fulfillment_rate, 1);
  });

  it('retains other dimensions and attributes unavailable promotion data', () => {
    const fixtures = createFactFixtures();
    fixtures['endpoints/promo.entityReport.json'] = { __throws: true, __error: { code: 'E_NETWORK', exitCode: 5, message: 'Synthetic unavailable source' } };
    const { status, envelope } = runCli(['diagnose', 'shop'], { fixtures });
    assert.equal(status, 0);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.status, 'partial');
    assert.equal(envelope.data.dimensions.orders.status, 'full');
    assert.equal(envelope.data.dimensions.inventory.status, 'full');
    assert.equal(envelope.data.dimensions.promo.status, 'partial');
    assert.ok(envelope.data.issues.some((issue) => issue.dimension === 'promo'));
    assert.ok(envelope.data.hints.some((hint) => hint.dimension === 'promo'));
  });

  it('routes --compare through the CLI to a comparison report', () => {
    const { status, envelope } = runCli(['diagnose', 'shop', '--compare', '--days', '7'], { fixtures: createFactFixtures() });
    assert.equal(status, 0);
    assert.equal(envelope.data.compare.status, 'full');
  });
});
