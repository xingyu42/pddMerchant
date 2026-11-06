import { it } from 'vitest';
import assert from 'node:assert/strict';
import { runCli } from '../helpers/isolated-cli.js';
import { createGoodsTrafficFixtures } from '../fixtures/test-data.js';

it('splits direct/indirect promotion, keeps absent campaigns at zero and negative differences null', () => {
  const result = runCli(['goods', 'traffic'], { fixtures: createGoodsTrafficFixtures() });
  assert.equal(result.status, 0);
  const view = result.envelope.data;
  assert.deepEqual(view.window, { start_date: '2026-10-01', end_date: '2026-10-30', days: 30 });
  assert.equal(view.items[0].promo_direct_amount_yuan, 2.46);
  assert.equal(view.items[0].promo_indirect_amount_yuan, 4);
  assert.equal(view.items[0].promo_spend_yuan, 2.46);
  assert.equal(view.items[0].promo_click_count, 6);
  assert.equal(view.items[0].non_promo_order_count, 2);
  assert.equal(view.items[1].promo_direct_order_count, 0);
  assert.equal(view.items[1].non_promo_amount_yuan, 20);
  assert.equal(view.items[2].non_promo_order_count, null);
  assert.equal(view.items[2].non_promo_amount_yuan, null);
  assert.equal(view.data_quality.promo_complete, true);
  for (const forbidden of ['http', 'SYN-PRIVATE', 'hdThumbUrl', 'adStrategy', 'peerPerf', 'bounce', 'cart', 'organic_visitor', 'paid_visitor']) {
    assert.equal(JSON.stringify(view).includes(forbidden), false, forbidden);
  }
});

it('handles all-shop hosting not enabled as zero', () => {
  const result = runCli(['goods', 'traffic', '--days', '7'], { fixtures: createGoodsTrafficFixtures({ promo: false }) });
  assert.equal(result.status, 0);
  assert.equal(result.envelope.data.items[0].promo_direct_order_count, 0);
});

it('degrades promo failures to null with an explicit quality flag', () => {
  const fixtures = { ...createGoodsTrafficFixtures(), 'endpoints/promo.goodsPromotionList.json': {
    __throws: true, __error: { code: 'E_NETWORK', message: 'synthetic failure', exitCode: 5 } } };
  const result = runCli(['goods', 'traffic'], { fixtures });
  assert.equal(result.status, 0);
  assert.equal(result.envelope.data.items[0].promo_direct_order_count, null);
  assert.equal(result.envelope.data.items[0].non_promo_order_count, null);
  assert.equal(result.envelope.data.data_quality.promo_complete, false);
});

it('paginates goods and marks twenty-page truncation', () => {
  const result = runCli(['goods', 'traffic'], { fixtures: createGoodsTrafficFixtures({ count: 1001, promo: false }) });
  assert.equal(result.status, 0);
  assert.equal(result.envelope.data.items.length, 1000);
  assert.equal(result.envelope.data.total, 1001);
  assert.equal(result.envelope.data.data_quality.goods_truncated, true);
});

it('rejects fourteen days with exit two', () => {
  const result = runCli(['goods', 'traffic', '--days', '14']);
  assert.equal(result.status, 2);
  assert.equal(result.envelope.error.code, 'E_USAGE');
});
