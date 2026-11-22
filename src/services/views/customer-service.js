import { toFiniteNumber } from '../../infra/units.js';
import { metricTable } from '../../infra/metrics.js';
import { defineReport, reportHints } from '../operating-report.js';

const CUSTOMER_SERVICE_CALIBER = '多多客服-客服数据（人工回复）';
const CS_SALES_CALIBER = '多多客服-销售数据';
const CS_TODAY_CALIBER = '多多客服-实时数据（3 分钟人工回复率）';
export const CUSTOMER_SERVICE_REPORT = defineReport({
  days: { min: 1, max: 63, default: 30, message: '--days 需为 {range} 的整数',
    description: '区间天数（{range}，截至昨天）' },
  hints: { trend_unavailable: '客服逐日趋势拉取失败', sales_unavailable: '客服销售数据拉取失败',
    sales_trend_unavailable: '客服销售逐日趋势拉取失败',
    today_unavailable: '今日实时客服数据拉取失败，today 为 null，历史数据不受影响' },
});

const CS_METRICS = metricTable([
  ['consult_user_count', 'consultUserCnt', 'count'], ['need_manual_reply_user_count', 'needManuReplyConsultUserCnt', 'count'],
  ['manual_receive_user_count', 'receiveUserCnt', 'count'], ['manual_reply_3min_rate_pct', 'manuReplyRate3Min', 'ratio'],
  ['reply_30s_rate_pct', 'manuReplyRate30s', 'ratio'], ['avg_manual_response_seconds', 'artificialResponseTime', 'seconds'],
  ['unsatisfied_review_count', 'unsatisfiedServeScoreCnt', 'count'], ['service_refund_count', 'serveRefundCnt', 'count'],
  ['complained_user_count', 'complainCsUserCnt', 'count'],
]);
const CS_REFERENCE_METRICS = metricTable([
  ['category_top10_avg_response_seconds', 'avgReplyTimeTop10', 'seconds'],
  ['category_avg_response_seconds', 'avgReplyTimeTotal', 'seconds'],
]);
// 销售数据口径：询单后 3 日内下单都计入询单当日，转化率与销售额均为平台原值。
const CS_SALES_METRICS = metricTable([
  ['inquiry_user_count', 'inquiryOrderUserCnt', 'count'], ['group_user_count', 'groupUserCnt', 'count'],
  ['inquiry_conversion_rate_pct', 'inquiryOrderTransformRate', 'ratio'], ['cs_sales_amount_yuan', 'csSalesAmount', 'yuan'],
]);
const CS_SALES_REFERENCE_METRICS = metricTable([
  ['category_top10_avg_inquiry_conversion_rate_pct', 'inquiryConfirmRateTop10Avg', 'ratio'],
  ['category_avg_inquiry_conversion_rate_pct', 'inquiryConfirmRateTotalAvg', 'ratio'],
]);
const CS_TODAY_METRICS = metricTable([
  ['consult_user_count', 'consultUserCnt', 'count'],
  ['need_manual_reply_user_count', 'needReplyUserCnt', 'count'],
  ['manual_receive_user_count', 'manuReceiveUserCnt', 'count'],
  ['manual_reply_3min_rate_pct', 'replyRate3Min', 'ratio'],
  ['manual_reply_3min_threshold_pct', 'replyRate3MinThreshold', 'ratio'],
]);
const CS_TODAY_HOURLY_METRICS = metricTable([
  ['reply_3min_user_count', 'replyUser3Min', 'count'],
  ['unreply_3min_user_count', 'unReplyUser3Min', 'count'],
]);
export const CS_SUMMARY_FIELDS = CS_METRICS.fields;
export const CS_TREND_ITEM_FIELDS = Object.freeze(['date', ...CS_SUMMARY_FIELDS, ...CS_REFERENCE_METRICS.fields]);
export const CS_SALES_FIELDS = Object.freeze(['caliber', 'window', 'summary', 'trend']);
export const CS_SALES_SUMMARY_FIELDS = CS_SALES_METRICS.fields;
export const CS_SALES_TREND_ITEM_FIELDS = Object.freeze(['date', ...CS_SALES_SUMMARY_FIELDS,
  ...CS_SALES_REFERENCE_METRICS.fields]);
export const CS_TODAY_FIELDS = Object.freeze(['snapshot_at', 'as_of_hour', 'caliber', ...CS_TODAY_METRICS.fields,
  'unreply_user_count', 'hourly']);
export const CS_TODAY_HOURLY_FIELDS = Object.freeze(['hour', ...CS_TODAY_HOURLY_METRICS.fields]);

function trendView(trend, metrics, reference) {
  if (trend === null) return null;
  const items = trend.items.map((item) => ({ date: item.statDate ?? null, ...metrics.project(item),
    ...reference.project(item) }));
  items.sort((left, right) => String(left.date).localeCompare(String(right.date)));
  return { items };
}

function salesView(sales) {
  if (sales === null) return null;
  return { caliber: CS_SALES_CALIBER, window: sales.window, summary: CS_SALES_METRICS.project(sales.summary),
    trend: trendView(sales.trend, CS_SALES_METRICS, CS_SALES_REFERENCE_METRICS) };
}

function salesHeadline({ window, summary }) {
  const range = `${window.start_date} 至 ${window.end_date}`;
  if (summary.inquiry_user_count === null) return `${range} 无询单数据`;
  const parts = [`${range} 询单 ${summary.inquiry_user_count} 人`];
  if (summary.group_user_count !== null) parts.push(`成团 ${summary.group_user_count} 人`);
  if (summary.inquiry_conversion_rate_pct !== null) parts.push(`询单转化率 ${summary.inquiry_conversion_rate_pct}%`);
  if (summary.cs_sales_amount_yuan !== null) parts.push(`客服销售额 ${summary.cs_sales_amount_yuan} 元`);
  return parts.join('，');
}

function headline(summary, days) {
  if (summary.consult_user_count === null) return [`近 ${days} 天无咨询数据`];
  const parts = [`近 ${days} 天咨询 ${summary.consult_user_count} 人`];
  if (summary.manual_reply_3min_rate_pct !== null) parts.push(`3 分钟人工回复率 ${summary.manual_reply_3min_rate_pct}%`);
  if (summary.avg_manual_response_seconds !== null) parts.push(`平均人工响应 ${summary.avg_manual_response_seconds} 秒`);
  return [parts.join('，')];
}

function parseSnapshotHour(snapshotAt) {
  if (typeof snapshotAt !== 'string') return null;
  const match = /^\d{4}-\d{2}-\d{2} (\d{2}):/.exec(snapshotAt);
  if (!match) return null;
  const hour = Number(match[1]);
  return hour >= 0 && hour <= 23 ? hour : null;
}

function todayView(today) {
  if (today === null) return null;
  const { snapshotAt, sources: { realtime, unreply, hourly } } = today;
  const cutoffHour = parseSnapshotHour(snapshotAt);
  const rows = (hourly ?? [])
    .filter((item) => cutoffHour === null || item.hour <= cutoffHour)
    .sort((left, right) => left.hour - right.hour);
  const latest = rows.at(-1) ?? null;
  return {
    snapshot_at: snapshotAt,
    as_of_hour: latest === null ? null : String(latest.hour).padStart(2, '0'),
    caliber: CS_TODAY_CALIBER,
    ...CS_TODAY_METRICS.project(realtime),
    unreply_user_count: toFiniteNumber(unreply?.unreply_num),
    hourly: rows.map((item) => ({
      hour: String(item.hour).padStart(2, '0'),
      ...CS_TODAY_HOURLY_METRICS.project(item),
    })),
  };
}

function todayHeadline(today) {
  const parts = [];
  if (today.manual_reply_3min_rate_pct !== null) parts.push(`3 分钟人工回复率 ${today.manual_reply_3min_rate_pct}%`);
  if (today.need_manual_reply_user_count !== null) parts.push(`需人工回复 ${today.need_manual_reply_user_count} 人`);
  if (today.unreply_user_count !== null) parts.push(`当前待回复 ${today.unreply_user_count} 人`);
  return parts.length === 0 ? '今日实时客服暂无数据' : `今日实时客服：${parts.join('，')}`;
}

// sales 为 null 表示销售数据整块不可用；sales.trend 为 null 表示只缺逐日趋势；today 为 null 表示今日实时不可用。
export function toCustomerServiceView(info, { window, trend = null, sales = null, today = null,
  hints = [], mallId = null }) {
  const summary = CS_METRICS.project(info);
  const salesBlock = salesView(sales);
  const todayBlock = todayView(today);
  return {
    headline: [
      ...headline(summary, window.days),
      ...(salesBlock ? [salesHeadline(salesBlock)] : []),
      ...(todayBlock ? [todayHeadline(todayBlock)] : []),
    ],
    window, caliber: CUSTOMER_SERVICE_CALIBER, summary,
    trend: trendView(trend, CS_METRICS, CS_REFERENCE_METRICS), sales: salesBlock, today: todayBlock,
    hints: reportHints(CUSTOMER_SERVICE_REPORT, hints), mall_id: mallId,
  };
}
