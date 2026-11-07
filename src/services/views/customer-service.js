import { metricTable } from '../../infra/metrics.js';
import { defineReport, reportHints } from '../operating-report.js';

const CUSTOMER_SERVICE_CALIBER = '多多客服-客服数据（人工回复）';
export const CUSTOMER_SERVICE_REPORT = defineReport({
  days: { min: 1, max: 63, default: 30, message: '--days 需为 {range} 的整数',
    description: '区间天数（{range}，截至昨天）' },
  hints: { trend_unavailable: '客服逐日趋势拉取失败' },
});

export const CS_METRICS = metricTable([
  ['consult_user_count', 'consultUserCnt', 'count'], ['need_manual_reply_user_count', 'needManuReplyConsultUserCnt', 'count'],
  ['manual_receive_user_count', 'receiveUserCnt', 'count'], ['manual_reply_3min_rate_pct', 'manuReplyRate3Min', 'ratio'],
  ['reply_30s_rate_pct', 'manuReplyRate30s', 'ratio'], ['avg_manual_response_seconds', 'artificialResponseTime', 'seconds'],
  ['unsatisfied_review_count', 'unsatisfiedServeScoreCnt', 'count'], ['service_refund_count', 'serveRefundCnt', 'count'],
  ['complained_user_count', 'complainCsUserCnt', 'count'],
]);
export const CS_REFERENCE_METRICS = metricTable([
  ['category_top10_avg_response_seconds', 'avgReplyTimeTop10', 'seconds'],
  ['category_avg_response_seconds', 'avgReplyTimeTotal', 'seconds'],
]);
export const CS_SUMMARY_FIELDS = CS_METRICS.fields;
export const CS_TREND_ITEM_FIELDS = Object.freeze(['date', ...CS_SUMMARY_FIELDS,
  'category_top10_avg_response_seconds', 'category_avg_response_seconds']);

function trendView(trend) {
  if (trend === null) return null;
  const items = trend.items.map((item) => ({ date: item.statDate ?? null, ...CS_METRICS.project(item),
    ...CS_REFERENCE_METRICS.project(item) }));
  items.sort((left, right) => String(left.date).localeCompare(String(right.date)));
  return { items };
}

function headline(summary, days) {
  if (summary.consult_user_count === null) return [`近 ${days} 天无咨询数据`];
  const parts = [`近 ${days} 天咨询 ${summary.consult_user_count} 人`];
  if (summary.manual_reply_3min_rate_pct !== null) parts.push(`3 分钟人工回复率 ${summary.manual_reply_3min_rate_pct}%`);
  if (summary.avg_manual_response_seconds !== null) parts.push(`平均人工响应 ${summary.avg_manual_response_seconds} 秒`);
  return [parts.join('，')];
}

export function toCustomerServiceView(info, { window, trend = null, hints = [], mallId = null }) {
  const summary = CS_METRICS.project(info);
  return { headline: headline(summary, window.days), window, caliber: CUSTOMER_SERVICE_CALIBER,
    summary, trend: trendView(trend), hints: reportHints(CUSTOMER_SERVICE_REPORT, hints), mall_id: mallId };
}
