import { it } from 'vitest';
import assert from 'node:assert/strict';
import { runCli } from '../helpers/isolated-cli.js';
import { createTrafficFixtures } from '../fixtures/test-data.js';

it('emits daily flow and platform peers in one JSON envelope', () => {
  const { status, envelope } = runCli(['diagnose', 'traffic'], { fixtures: createTrafficFixtures() });
  assert.equal(status, 0);
  assert.equal(envelope.command, 'diagnose.traffic');
  assert.deepEqual(envelope.data.window, { start_date: '2026-10-01', end_date: '2026-10-30', days: 30 });
  assert.deepEqual(envelope.data.summary, { shop_visitor_count: 30, pay_order_count: 8, pay_amount_yuan: 35.79 });
  assert.equal(envelope.data.items[0].shop_visitor_count_peer_avg, 5);
});

it('emits a separate today block from the realtime flow and cumulative trade sources', () => {
  const { status, envelope } = runCli(['diagnose', 'traffic'], { fixtures: createTrafficFixtures() });
  assert.equal(status, 0);
  const { snapshot_at: snapshotAt, ...today } = envelope.data.today;
  assert.match(snapshotAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.deepEqual(today, { as_of_hour: '01',
    shop_visitor_count: 377, shop_page_view_count: 912, goods_visitor_count: 350, goods_page_view_count: 801,
    pay_amount_yuan: 745.36, pay_order_count: 39, pay_buyer_count: 36, avg_order_value_yuan: 19.11, pay_conversion_pct: 9.55,
    hourly: [
      { hour: '00', pay_amount_yuan: 12.5, pay_order_count: 1, pay_buyer_count: 1 },
      { hour: '01', pay_amount_yuan: 745.36, pay_order_count: 39, pay_buyer_count: 36 },
    ] });
  assert.equal(envelope.data.items.length, 2);
  assert.ok(envelope.data.headline.includes('今日截至 01 时累计成交 745.36 元、39 单，店铺访客 377 人'));
});

it.each([[[]], [null]])('keeps realtime flow but reports trade as unknown when todayRtList is %j', (todayRtList) => {
  const fixtures = { ...createTrafficFixtures(), 'endpoints/traffic.todayTrade.json': {
    success: true, errorCode: 1000000, result: { todayRtList, dayList: null } } };
  const { status, envelope } = runCli(['diagnose', 'traffic'], { fixtures });
  assert.equal(status, 0);
  const { today } = envelope.data;
  assert.equal(today.shop_visitor_count, 377);
  assert.equal(today.goods_page_view_count, 801);
  for (const key of ['as_of_hour', 'pay_amount_yuan', 'pay_order_count', 'pay_buyer_count', 'avg_order_value_yuan',
    'pay_conversion_pct']) assert.equal(today[key], null, key);
  assert.deepEqual(today.hourly, []);
  assert.ok(envelope.data.headline.includes('今日暂无成交累计数据，店铺访客 377 人'));
});

it.each(['traffic.todayFlow', 'traffic.todayTrade'])('degrades today to null with a hint when %s fails', (name) => {
  const fixtures = { ...createTrafficFixtures(), [`endpoints/${name}.json`]: {
    __throws: true, __error: { code: 'E_NETWORK', message: 'synthetic failure', exitCode: 5 } } };
  const { status, envelope } = runCli(['diagnose', 'traffic'], { fixtures });
  assert.equal(status, 0);
  assert.equal(envelope.data.today, null);
  assert.ok(envelope.data.hints.includes('今日实时数据拉取失败，today 为 null，逐日数据不受影响'));
  assert.deepEqual(envelope.data.headline, ['近 30 天流量，返回 2 个统计日']);
  assert.deepEqual(envelope.data.summary, { shop_visitor_count: 30, pay_order_count: 8, pay_amount_yuan: 35.79 });
  assert.equal(envelope.data.items.length, 2);
});

it('rejects thirty-one days with exit two', () => {
  const result = runCli(['diagnose', 'traffic', '--days', '31']);
  assert.equal(result.status, 2);
});

it('fails the command on main source failure', () => {
  const fixtures = { ...createTrafficFixtures(), 'endpoints/traffic.overviewList.json': {
    __throws: true, __error: { code: 'E_BUSINESS', message: 'synthetic failure', exitCode: 6 } } };
  const result = runCli(['diagnose', 'traffic'], { fixtures });
  assert.equal(result.status, 6);
  assert.equal(result.envelope.data, null);
});
