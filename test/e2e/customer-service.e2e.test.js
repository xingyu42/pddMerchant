import { it } from 'vitest';
import assert from 'node:assert/strict';
import { runCli } from '../helpers/isolated-cli.js';
import { createCustomerServiceFixtures } from '../fixtures/test-data.js';

it('emits desert summary and daily consultations with nulls and no account names', () => {
  const result = runCli(['diagnose', 'customer-service'], { fixtures: createCustomerServiceFixtures() });
  assert.equal(result.status, 0);
  assert.equal(result.envelope.command, 'diagnose.customer-service');
  const view = result.envelope.data;
  assert.equal(view.caliber, '多多客服-客服数据（人工回复）');
  assert.equal(view.summary.manual_reply_3min_rate_pct, 100);
  assert.equal(view.summary.avg_manual_response_seconds, 14.67);
  assert.equal(view.window.days, 30);
  assert.equal(view.trend.items.length, 2);
  assert.equal(view.trend.items[0].consult_user_count, null);
  assert.equal(view.trend.items[0].manual_reply_3min_rate_pct, null);
  assert.equal(view.trend.items[0].category_avg_response_seconds, 20);
  assert.equal(view.mall_id, '900001');
  for (const forbidden of ['cs_name', 'SYN-CS-PRIVATE', 'Compare', 'reply30sRateStapleRank']) {
    assert.equal(JSON.stringify(view).includes(forbidden), false, forbidden);
  }
});

it('emits the sales block with its own caliber and window, upstream nulls and a headline line', () => {
  const result = runCli(['diagnose', 'customer-service', '--days', '7'], { fixtures: createCustomerServiceFixtures() });
  assert.equal(result.status, 0);
  const { sales, headline, window, hints } = result.envelope.data;
  assert.equal(sales.caliber, '多多客服-销售数据');
  assert.equal(sales.window.days, 7);
  // 销售窗口比咨询窗口早结束两天，且两者天数相同
  assert.equal(Date.parse(window.end_date) - Date.parse(sales.window.end_date), 2 * 86400000);
  assert.equal(Date.parse(window.start_date) - Date.parse(sales.window.start_date), 2 * 86400000);
  assert.deepEqual(sales.summary, { inquiry_user_count: 12, group_user_count: 6,
    inquiry_conversion_rate_pct: 50, cs_sales_amount_yuan: 153.67 });
  const items = sales.trend.items;
  assert.equal(items.length, 5);
  assert.deepEqual(items.map((item) => item.date), items.map((item) => item.date).toSorted());
  assert.equal(items.at(-1).date, sales.window.end_date);
  const metrics = (item) => [item.inquiry_user_count, item.group_user_count,
    item.inquiry_conversion_rate_pct, item.cs_sales_amount_yuan];
  assert.deepEqual(items.map(metrics), [[12, 6, 50, 153.67], [null, null, null, null], [0, 0, null, null],
    [2, 0, 0, null], [null, null, null, null]]);
  assert.equal(items[1].category_top10_avg_inquiry_conversion_rate_pct, 81.71);
  assert.equal(items[1].category_avg_inquiry_conversion_rate_pct, 27.83);
  assert.equal(items[4].category_top10_avg_inquiry_conversion_rate_pct, null);
  assert.equal(headline.length, 3);
  assert.equal(headline[1], `${sales.window.start_date} 至 ${sales.window.end_date} 询单 12 人，成团 6 人，询单转化率 50%，客服销售额 153.67 元`);
  assert.equal(headline[2], '今日实时客服：3 分钟人工回复率 87.5%，需人工回复 2 人，当前待回复 1 人');
  const { today } = result.envelope.data;
  assert.equal(today.caliber, '多多客服-实时数据（3 分钟人工回复率）');
  assert.equal(today.unreply_user_count, 1);
  assert.deepEqual(today.hourly.map((h) => h.hour), ['00', '09', '10']);
  assert.deepEqual(hints, []);
  for (const forbidden of ['CanImprove', 'Compare', '23.14']) {
    assert.equal(JSON.stringify(result.envelope.data).includes(forbidden), false, forbidden);
  }
  assert.equal(Object.hasOwn(sales.summary, 'category_avg_inquiry_conversion_rate_pct'), false);
});

it('keeps consultations when the sales summary fails and keeps the summary when only the daily sales fail', () => {
  const failure = { __throws: true, __error: { code: 'E_BUSINESS', message: 'fixture unavailable', exitCode: 6 } };
  const whole = runCli(['diagnose', 'customer-service'],
    { fixtures: { ...createCustomerServiceFixtures(), 'endpoints/cs.salesOverview.json': failure } });
  assert.equal(whole.status, 0);
  assert.equal(whole.envelope.ok, true);
  assert.equal(whole.envelope.data.sales, null);
  assert.deepEqual(whole.envelope.data.hints, ['客服销售数据拉取失败']);
  assert.equal(whole.envelope.data.headline.length, 2);
  assert.equal(whole.envelope.data.summary.consult_user_count, 3);
  assert.equal(whole.envelope.data.trend.items.length, 2);
  const daily = runCli(['diagnose', 'customer-service'],
    { fixtures: { ...createCustomerServiceFixtures(), 'endpoints/cs.monthSalesTrend.json': failure } });
  assert.equal(daily.status, 0);
  assert.equal(daily.envelope.data.sales.trend, null);
  assert.equal(daily.envelope.data.sales.summary.inquiry_user_count, 12);
  assert.deepEqual(daily.envelope.data.hints, ['客服销售逐日趋势拉取失败']);
  assert.equal(daily.envelope.data.headline.length, 3);
});

it('degrades cs today failures to null with hint while keeping summary, trend and sales', () => {
  const failure = { __throws: true, __error: { code: 'E_NETWORK', message: 'today unavailable', exitCode: 5 } };
  for (const endpoint of ['endpoints/cs.todayRealtime.json', 'endpoints/cs.todayHourConsult.json']) {
    const result = runCli(['diagnose', 'customer-service'],
      { fixtures: { ...createCustomerServiceFixtures(), [endpoint]: failure } });
    assert.equal(result.status, 0);
    assert.equal(result.envelope.data.today, null);
    assert.equal(result.envelope.data.summary.consult_user_count, 3);
    assert.equal(result.envelope.data.sales.summary.inquiry_user_count, 12);
    assert.equal(result.envelope.data.headline.length, 2);
    assert.deepEqual(result.envelope.data.hints, ['今日实时客服数据拉取失败，today 为 null，历史数据不受影响']);
  }
});

it('returns exit two for days beyond sixty-three', () => {
  const result = runCli(['diagnose', 'customer-service', '--days', '64'], { fixtures: createCustomerServiceFixtures() });
  assert.equal(result.status, 2);
  assert.equal(result.envelope.error.code, 'E_USAGE');
});

it('retains the mandatory summary when the optional trend fails', () => {
  const fixtures = { ...createCustomerServiceFixtures(), 'endpoints/cs.monthTrend.json': {
    __throws: true, __error: { code: 'E_NETWORK', message: 'fixture unavailable', exitCode: 5 },
  } };
  const { envelope } = runCli(['diagnose', 'customer-service'], { fixtures });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.trend, null);
  assert.equal(envelope.data.summary.consult_user_count, 3);
  assert.equal(envelope.data.hints.length, 1);
});

it('fails when the primary summary fails', () => {
  const fixtures = { ...createCustomerServiceFixtures(), 'endpoints/cs.overview.json': {
    __throws: true, __error: { code: 'E_BUSINESS', message: 'fixture unavailable', exitCode: 6 },
  } };
  const result = runCli(['diagnose', 'customer-service'], { fixtures });
  assert.equal(result.status, 6);
  assert.equal(result.envelope.data, null);
});
