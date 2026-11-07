import { it } from 'vitest';
import assert from 'node:assert/strict';
import { toCustomerServiceView, CS_SUMMARY_FIELDS, CS_TREND_ITEM_FIELDS } from '../../src/services/views/customer-service.js';

const window = { start_date: '2026-10-01', end_date: '2026-10-30', days: 30 };

it('maps desert metrics, percent rates and response seconds through exact whitelists', () => {
  const info = { consultUserCnt: 3, needManuReplyConsultUserCnt: 2, receiveUserCnt: 2,
    manuReplyRate3Min: 1, manuReplyRate30s: 0.666666, artificialResponseTime: 14.666,
    unsatisfiedServeScoreCnt: 0, serveRefundCnt: 1, complainCsUserCnt: 0, cs_name: 'PRIVATE' };
  const view = toCustomerServiceView(info, { window, mallId: '900001', trend: { items: [{ ...info,
    statDate: '2026-10-30', avgReplyTimeTop10: 5.555, avgReplyTimeTotal: 20.126 }] } });
  assert.deepEqual(view.summary, { consult_user_count: 3, need_manual_reply_user_count: 2,
    manual_receive_user_count: 2, manual_reply_3min_rate_pct: 100, reply_30s_rate_pct: 66.67,
    avg_manual_response_seconds: 14.67, unsatisfied_review_count: 0, service_refund_count: 1,
    complained_user_count: 0 });
  assert.deepEqual(Object.keys(view.summary), CS_SUMMARY_FIELDS);
  assert.deepEqual(Object.keys(view.trend.items[0]), CS_TREND_ITEM_FIELDS);
  assert.equal(view.trend.items[0].category_top10_avg_response_seconds, 5.56);
  assert.equal(view.trend.items[0].category_avg_response_seconds, 20.13);
  assert.equal(view.caliber, '多多客服-客服数据（人工回复）');
  assert.deepEqual(view.headline, ['近 30 天咨询 3 人，3 分钟人工回复率 100%，平均人工响应 14.67 秒']);
  assert.deepEqual(view.window, window);
  assert.equal(view.mall_id, '900001');
  assert.equal(JSON.stringify(view).includes('PRIVATE'), false);
});

it('keeps no-consultation metrics null and category references available', () => {
  const view = toCustomerServiceView({ consultUserCnt: null }, { window,
    trend: { items: [{ statDate: '2026-10-30', consultUserCnt: null, avgReplyTimeTotal: 20 }] } });
  assert.ok(Object.values(view.summary).every((value) => value === null));
  assert.equal(view.trend.items[0].manual_reply_3min_rate_pct, null);
  assert.equal(view.trend.items[0].category_avg_response_seconds, 20);
  assert.deepEqual(view.headline, ['近 30 天无咨询数据']);
  const partial = toCustomerServiceView({}, { window, hints: ['trend_unavailable'] });
  assert.equal(partial.trend, null);
  assert.deepEqual(partial.hints, ['客服逐日趋势拉取失败']);
});

it('coerces numeric count strings and preserves missing counts in summary and trend', () => {
  const info = { consultUserCnt: '3', receiveUserCnt: '0', serveRefundCnt: '' };
  const view = toCustomerServiceView(info, { window, trend: { items: [info] } });
  assert.equal(view.summary.consult_user_count, 3);
  assert.equal(view.summary.manual_receive_user_count, 0);
  assert.equal(view.summary.service_refund_count, null);
  assert.equal(view.trend.items[0].consult_user_count, 3);
});
