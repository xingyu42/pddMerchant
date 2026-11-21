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
  assert.equal(view.today.pay_amount_yuan, 1203.64);
  assert.equal(view.today.pay_conversion_pct, 9.55);
  assert.equal(view.today.goods_visitor_count, 350);
  assert.equal(view.headline.length, 2);
  assert.deepEqual(result.envelope.meta.warnings, []);
  for (const forbidden of ['http', 'SYN-PRIVATE', 'hdThumbUrl', 'adStrategy', 'peerPerf', 'bounce', 'cart', 'organic_visitor', 'paid_visitor', 'newMerchant', 'yesterdayGoodsDetail', '99.99']) {
    assert.equal(JSON.stringify(view).includes(forbidden), false, forbidden);
  }
});

it('outputs single-goods today summary and ascending hourly list under --goods-id', () => {
  const result = runCli(['goods', 'traffic', '--goods-id', '101'], { fixtures: createGoodsTrafficFixtures() });
  assert.equal(result.status, 0);
  const { today, headline } = result.envelope.data;
  assert.equal(today.as_of_hour, '02');
  assert.equal(today.pay_amount_yuan, 745.36);
  assert.deepEqual(today.hourly.map((entry) => entry.hour), ['00', '02']);
  assert.equal(today.hourly[0].pay_amount_yuan, null);
  assert.equal(headline.length, 2);
  assert.equal(headline[1], '商品 101 今日实时访客 350 人，成交 745.36 元、39 单，小时序列截至 02 时');
  assert.equal(JSON.stringify(result.envelope.data).includes('8888'), false);
});

it('surfaces overview format parse warnings in meta.warnings while keeping null', () => {
  const base = createGoodsTrafficFixtures();
  const badOverview = structuredClone(base['endpoints/traffic.goodsTodayOverview.json']);
  badOverview.result.payOrdrAmtRt = '--';
  badOverview.result.payUvRtoRt = null;
  const result = runCli(['goods', 'traffic'], {
    fixtures: { ...base, 'endpoints/traffic.goodsTodayOverview.json': badOverview },
  });
  assert.equal(result.status, 0);
  assert.equal(result.envelope.data.today.pay_amount_yuan, null);
  assert.equal(result.envelope.data.today.pay_conversion_pct, null);
  assert.equal(result.envelope.meta.warnings.length, 1);
  assert.equal(result.envelope.meta.warnings[0].code, 'goods_today_parse_failed');
});

it('degrades goods today failures to null with hint while keeping historical items intact', () => {
  const fixtures = {
    ...createGoodsTrafficFixtures(),
    'endpoints/traffic.goodsTodayOverview.json': {
      __throws: true, __error: { code: 'E_BUSINESS', message: '平台返回字体混淆数据', exitCode: 6 },
    },
  };
  const result = runCli(['goods', 'traffic'], { fixtures });
  assert.equal(result.status, 0);
  assert.equal(result.envelope.data.today, null);
  assert.equal(result.envelope.data.items.length, 3);
  assert.equal(result.envelope.data.headline.length, 1);
  assert.ok(result.envelope.data.hints.some((hint) => hint.includes('今日实时数据拉取失败')));
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
