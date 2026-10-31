import { round, toPct } from '../../infra/units.js';
import { CUSTOMER_SERVICE_CALIBER, CUSTOMER_SERVICE_HINT_LABEL } from './labels.js';

const METRICS = [
  ['consult_user_count', 'consultUserCnt'], ['need_manual_reply_user_count', 'needManuReplyConsultUserCnt'],
  ['manual_receive_user_count', 'receiveUserCnt'], ['manual_reply_3min_rate_pct', 'manuReplyRate3Min', toPct],
  ['reply_30s_rate_pct', 'manuReplyRate30s', toPct], ['avg_manual_response_seconds', 'artificialResponseTime', round],
  ['unsatisfied_review_count', 'unsatisfiedServeScoreCnt'], ['service_refund_count', 'serveRefundCnt'],
  ['complained_user_count', 'complainCsUserCnt'],
];
export const CS_SUMMARY_FIELDS = Object.freeze(METRICS.map(([key]) => key));
export const CS_TREND_ITEM_FIELDS = Object.freeze(['date', ...CS_SUMMARY_FIELDS,
  'category_top10_avg_response_seconds', 'category_avg_response_seconds']);

function metricsView(raw) {
  return Object.fromEntries(METRICS.map(([key, field, convert]) =>
    [key, convert ? convert(raw[field]) : raw[field] ?? null]));
}

function trendView(trend) {
  if (trend === null) return null;
  const items = trend.items.map((item) => ({ date: item.statDate ?? null, ...metricsView(item),
    category_top10_avg_response_seconds: round(item.avgReplyTimeTop10),
    category_avg_response_seconds: round(item.avgReplyTimeTotal) }));
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
  const summary = metricsView(info);
  return { headline: headline(summary, window.days), window, caliber: CUSTOMER_SERVICE_CALIBER,
    summary, trend: trendView(trend), hints: hints.map((key) => CUSTOMER_SERVICE_HINT_LABEL[key]), mall_id: mallId };
}
