import { it } from 'vitest';
import assert from 'node:assert/strict';
import { toCustomerServiceView, CS_SUMMARY_FIELDS, CS_TREND_ITEM_FIELDS, CS_SALES_FIELDS,
  CS_SALES_SUMMARY_FIELDS, CS_SALES_TREND_ITEM_FIELDS, CS_TODAY_FIELDS,
  CS_TODAY_HOURLY_FIELDS } from '../../src/services/views/customer-service.js';

const window = { start_date: '2026-10-01', end_date: '2026-10-30', days: 30 };
const salesWindow = { start_date: '2026-11-10', end_date: '2026-11-16', days: 7 };
const salesSummary = { inquiryOrderUserCnt: 12, groupUserCnt: 6, inquiryOrderTransformRate: 0.5,
  csSalesAmount: 153.666, csCanImproveSalesAmount: 23.14, inquiryOrderUserCntCompare: 0.2 };
const salesOf = (summary, trend = null) => toCustomerServiceView({ consultUserCnt: 3 },
  { window, sales: { window: salesWindow, summary, trend } });

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

it('maps the sales block to percent and yuan with its own caliber, window and headline line', () => {
  const view = salesOf(salesSummary, { items: [
    { ...salesSummary, statDate: '2026-11-16', inquiryConfirmRateTop10Avg: 0.817113, inquiryConfirmRateTotalAvg: 0.278309 },
    { statDate: '2026-11-10', inquiryOrderUserCnt: 0, groupUserCnt: 0, inquiryOrderTransformRate: null,
      csSalesAmount: null, inquiryConfirmRateTop10Avg: 0.823169 }] });
  assert.deepEqual(Object.keys(view.sales), CS_SALES_FIELDS);
  assert.equal(view.sales.caliber, '多多客服-销售数据');
  assert.deepEqual(view.sales.window, salesWindow);
  assert.deepEqual(view.sales.summary, { inquiry_user_count: 12, group_user_count: 6,
    inquiry_conversion_rate_pct: 50, cs_sales_amount_yuan: 153.67 });
  assert.deepEqual(Object.keys(view.sales.summary), CS_SALES_SUMMARY_FIELDS);
  assert.deepEqual(view.sales.trend.items.map((item) => item.date), ['2026-11-10', '2026-11-16']);
  assert.deepEqual(Object.keys(view.sales.trend.items[0]), CS_SALES_TREND_ITEM_FIELDS);
  assert.deepEqual(view.sales.trend.items[0], { date: '2026-11-10', inquiry_user_count: 0, group_user_count: 0,
    inquiry_conversion_rate_pct: null, cs_sales_amount_yuan: null,
    category_top10_avg_inquiry_conversion_rate_pct: 82.32, category_avg_inquiry_conversion_rate_pct: null });
  assert.equal(view.sales.trend.items[1].category_top10_avg_inquiry_conversion_rate_pct, 81.71);
  assert.equal(view.sales.trend.items[1].category_avg_inquiry_conversion_rate_pct, 27.83);
  assert.deepEqual(view.headline, ['近 30 天咨询 3 人',
    '2026-11-10 至 2026-11-16 询单 12 人，成团 6 人，询单转化率 50%，客服销售额 153.67 元']);
  assert.equal(view.caliber, '多多客服-客服数据（人工回复）');
  assert.deepEqual(view.window, window);
  for (const forbidden of ['CanImprove', 'Compare', '23.14']) {
    assert.equal(JSON.stringify(view).includes(forbidden), false, forbidden);
  }
});

it('omits null parts of the sales headline and states missing inquiry data', () => {
  const zeroGroup = salesOf({ inquiryOrderUserCnt: 2, groupUserCnt: 0, inquiryOrderTransformRate: 0, csSalesAmount: null });
  assert.equal(zeroGroup.sales.summary.cs_sales_amount_yuan, null);
  assert.equal(zeroGroup.sales.trend, null);
  assert.equal(zeroGroup.headline[1], '2026-11-10 至 2026-11-16 询单 2 人，成团 0 人，询单转化率 0%');
  const zeroInquiry = salesOf({ inquiryOrderUserCnt: 0, groupUserCnt: 0, inquiryOrderTransformRate: null, csSalesAmount: null });
  assert.equal(zeroInquiry.headline[1], '2026-11-10 至 2026-11-16 询单 0 人，成团 0 人');
  const missing = salesOf({ inquiryOrderUserCnt: null, groupUserCnt: null });
  assert.ok(Object.values(missing.sales.summary).every((value) => value === null));
  assert.equal(missing.headline[1], '2026-11-10 至 2026-11-16 无询单数据');
});

it('keeps sales null with its hint and leaves the headline to the consultation line', () => {
  const view = toCustomerServiceView({ consultUserCnt: 3 }, { window, hints: ['sales_unavailable'] });
  assert.equal(view.sales, null);
  assert.deepEqual(view.headline, ['近 30 天咨询 3 人']);
  assert.deepEqual(view.hints, ['客服销售数据拉取失败']);
  assert.deepEqual(toCustomerServiceView({}, { window, hints: ['sales_trend_unavailable'] }).hints,
    ['客服销售逐日趋势拉取失败']);
});

it('coerces numeric count strings and preserves missing counts in summary and trend', () => {
  const info = { consultUserCnt: '3', receiveUserCnt: '0', serveRefundCnt: '' };
  const view = toCustomerServiceView(info, { window, trend: { items: [info] } });
  assert.equal(view.summary.consult_user_count, 3);
  assert.equal(view.summary.manual_receive_user_count, 0);
  assert.equal(view.summary.service_refund_count, null);
  assert.equal(view.trend.items[0].consult_user_count, 3);
});

it('projects cs today block with explicit caliber, padded ascending hours and early-morning nulls', () => {
  const view = toCustomerServiceView({ consultUserCnt: 3 }, {
    window,
    sales: { window: salesWindow, summary: salesSummary, trend: null },
    today: {
      snapshotAt: '2026-11-22 10:00:00',
      sources: {
        realtime: { consultUserCnt: 18, needReplyUserCnt: 2, manuReceiveUserCnt: 16,
          replyRate3Min: 0.875, replyRate3MinThreshold: 0.5 },
        unreply: { unreply_num: 1 },
        hourly: [{ hour: 10, replyUser3Min: 4, unReplyUser3Min: 1 }, { hour: 0, replyUser3Min: 0, unReplyUser3Min: 0 }],
      },
    },
  });
  assert.deepEqual(Object.keys(view.today), CS_TODAY_FIELDS);
  assert.equal(view.today.caliber, '多多客服-实时数据（3 分钟人工回复率）');
  assert.equal(view.today.manual_reply_3min_rate_pct, 87.5);
  assert.equal(view.today.manual_reply_3min_threshold_pct, 50);
  assert.equal(view.today.unreply_user_count, 1);
  assert.deepEqual(view.today.hourly.map((entry) => entry.hour), ['00', '10']);
  assert.deepEqual(Object.keys(view.today.hourly[0]), CS_TODAY_HOURLY_FIELDS);
  assert.equal(view.headline[2], '今日实时客服：3 分钟人工回复率 87.5%，需人工回复 2 人，当前待回复 1 人');

  const earlyMorning = toCustomerServiceView({ consultUserCnt: 3 }, {
    window,
    today: {
      snapshotAt: '2026-11-22 04:20:00',
      sources: {
        realtime: { consultUserCnt: null, needReplyUserCnt: 0, manuReceiveUserCnt: null,
          replyRate3Min: null, replyRate3MinThreshold: 0.5 },
        unreply: { unreply_num: 0 },
        hourly: [],
      },
    },
  });
  assert.equal(earlyMorning.today.manual_reply_3min_rate_pct, null);
  assert.equal(earlyMorning.today.need_manual_reply_user_count, 0);
  assert.deepEqual(earlyMorning.today.hourly, []);
  assert.equal(earlyMorning.headline[1], '今日实时客服：需人工回复 0 人，当前待回复 0 人');

  const emptyHeadline = toCustomerServiceView({ consultUserCnt: 3 }, {
    window,
    today: { snapshotAt: '2026-11-22 04:20:00', sources: { realtime: {}, unreply: {}, hourly: [] } },
  });
  assert.equal(emptyHeadline.headline[1], '今日实时客服暂无数据');
});
