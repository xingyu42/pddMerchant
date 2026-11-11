import { it } from 'vitest';
import assert from 'node:assert/strict';
import {
  EXPERIENCE_PLAN_FIELDS, EXPERIENCE_PLAN_ITEM_FIELDS, EXPERIENCE_PLAN_WINDOW_FIELDS, toExperiencePlanView,
} from '../../src/services/views/experience-plan.js';

const yuan = (value) => ({ unit: 'YUAN', value, unitCode: 1 });
// 上海 2026-11-05 00:00:00 至 2026-11-11 23:59:59.999
const window = { days: 7, startMs: Date.parse('2026-11-04T16:00:00Z'), endMs: Date.parse('2026-11-11T16:00:00Z') - 1 };
const row = { orderSn: 'SYN-1', serviceAmountVO: yuan('1.11'), feeStatusDesc: '收费成功', displayStatus: 1,
  effectiveTime: Date.parse('2026-11-07T07:20:00Z'), shippingTime: Date.parse('2026-11-07T04:33:20Z'), isFree: false };

function view({ status = { configStatus: 1 }, price = yuan('1.11'), profits = { orderCount: 209, compensationCount: 3 },
  list = { total: 203, items: [row] }, options = {} } = {}) {
  return toExperiencePlanView({ status, available: { price }, profits, list },
    { window, page: 1, hints: ['count_caliber'], mallId: 'm-1', ...options });
}

it('projects plan facts, window and fee records with the exact field sets', () => {
  const { data, warnings } = view();
  assert.deepEqual(Object.keys(data), EXPERIENCE_PLAN_FIELDS);
  assert.deepEqual(Object.keys(data.window), EXPERIENCE_PLAN_WINDOW_FIELDS);
  assert.deepEqual(Object.keys(data.items[0]), EXPERIENCE_PLAN_ITEM_FIELDS);
  assert.deepEqual(data.window, { days: 7, start_at: '2026-11-05 00:00:00', end_at: '2026-11-11 23:59:59' });
  assert.deepEqual(data.items[0], { order_sn: 'SYN-1', service_fee_yuan: 1.11, fee_status: '收费成功',
    service_status: '生效中', effective_at: '2026-11-07 15:20:00', shipped_at: '2026-11-07 12:33:20', is_free: false });
  assert.equal(data.plan_status, 1);
  assert.equal(data.today_fee_per_order_yuan, 1.11);
  assert.equal(data.mall_id, 'm-1');
  assert.deepEqual(data.headline, ['消费者体验提升计划状态码 1（平台原值）', '今日服务费 1.11 元/单',
    '近 7 天收费订单 209 单，已获运费补偿订单 3 单', '近 7 天收费记录共 203 条，第 1 页返回 1 条']);
  assert.equal(data.hints.length, 1);
  assert.deepEqual(warnings, []);
});

it('parses yuan strings exactly and nulls other units once per unit in warnings', () => {
  const { data, warnings } = view({ price: { unit: 'FEN', value: '111' }, list: { total: 3, items: [
    { ...row, serviceAmountVO: yuan('0.10') }, { ...row, serviceAmountVO: { unit: 'FEN', value: '10' } },
    { ...row, serviceAmountVO: { value: '1' } },
  ] } });
  assert.equal(data.today_fee_per_order_yuan, null);
  assert.deepEqual(data.items.map((item) => item.service_fee_yuan), [0.1, null, null]);
  assert.equal(warnings.length, 2);
  assert.ok(warnings[0].includes('FEN'));
  assert.ok(warnings[1].includes('缺失'));
});

it('keeps missing or invalid counts and fields null, labels unknown service codes, and states empty facts', () => {
  const { data } = view({ status: {}, price: null, profits: { orderCount: -1, compensationCount: '2.5' },
    list: { total: 0, items: [{ orderSn: 42, displayStatus: 9 }] }, options: { mallId: undefined } });
  assert.equal(data.plan_status, null);
  assert.equal(data.charged_order_count, null);
  assert.equal(data.compensated_order_count, null);
  assert.equal(data.mall_id, null);
  assert.deepEqual(data.items[0], { order_sn: '42', service_fee_yuan: null, fee_status: null,
    service_status: '未知(9)', effective_at: null, shipped_at: null, is_free: null });
  assert.deepEqual(data.headline, ['消费者体验提升计划状态码 缺失（平台原值）', '今日服务费费率缺失',
    '近 7 天收费订单 缺失，已获运费补偿订单 缺失', '近 7 天无收费记录']);
});

it('names a one-day window as today', () => {
  const { data } = toExperiencePlanView({ status: { configStatus: 1 }, available: { price: null },
    profits: { orderCount: 0, compensationCount: 0 }, list: { total: 0, items: [] } },
  { window: { ...window, days: 1 }, page: 1, hints: [] });
  assert.equal(data.headline[2], '今天收费订单 0 单，已获运费补偿订单 0 单');
  assert.deepEqual(data.hints, []);
});
