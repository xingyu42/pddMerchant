import { round } from '../../infra/units.js';
import { metricTable, sumKnown } from '../../infra/metrics.js';
import { defineReport, reportHints } from '../operating-report.js';

export const TRAFFIC_REPORT = defineReport({
  days: { min: 1, max: 30, default: 30, message: '--days 需为 {range} 的整数',
    description: '窗口天数（{range}，截至平台就绪日期）' },
  hints: {
    daily_uv_sum: '访客汇总为逐日访客数之和，跨日存在重复访客',
    missing_days: '返回的统计日少于窗口天数，summary 仅汇总已返回的统计日',
    today_unavailable: '今日实时数据拉取失败，today 为 null，逐日数据不受影响',
  },
});

const TRAFFIC_METRICS = metricTable([
  ['shop_visitor_count', 'uv', 'count'], ['shop_page_view_count', 'pv', 'count'], ['goods_visitor_count', 'guv', 'count'],
  ['goods_page_view_count', 'gpv', 'count'], ['pay_buyer_count', 'payOrdrUsrCnt', 'count'], ['pay_order_count', 'payOrdrCnt', 'count'],
  ['pay_amount_yuan', 'payOrdrAmt', 'yuan'], ['pay_conversion_pct', 'payUvRto', 'ratio'],
  ['avg_order_value_yuan', 'payOrdrAup', 'yuan'], ['uv_value_yuan', 'uvCfmVal', 'yuan'],
]);
const PEERS = [['', ''], ['_peer_avg', '1dPln'], ['_peer_excellent', '1dOst']];
export const TRAFFIC_ITEM_FIELDS = Object.freeze(['date', ...TRAFFIC_METRICS.fields.flatMap((key) => PEERS.map(([suffix]) => key + suffix))]);
export const TRAFFIC_SUMMARY_FIELDS = Object.freeze(['shop_visitor_count', 'pay_order_count', 'pay_amount_yuan']);

const TODAY_FLOW_METRICS = metricTable([
  ['shop_visitor_count', 'muvRt', 'count'], ['shop_page_view_count', 'mpvRt', 'count'],
  ['goods_visitor_count', 'guvRt', 'count'], ['goods_page_view_count', 'gpvRt', 'count'],
]);
const TODAY_HOURLY_METRICS = metricTable([
  ['pay_amount_yuan', 'payOrdrAmt', 'yuan'], ['pay_order_count', 'payOrdrCnt', 'count'],
  ['pay_buyer_count', 'payOrdrUsrCnt', 'count'],
]);
const TODAY_TRADE_METRICS = metricTable([...TODAY_HOURLY_METRICS.entries,
  ['avg_order_value_yuan', 'payOrdrAup', 'yuan'], ['pay_conversion_pct', 'payUvRto', 'ratio']]);
export const TRAFFIC_TODAY_FIELDS = Object.freeze(['snapshot_at', 'as_of_hour', ...TODAY_FLOW_METRICS.fields,
  ...TODAY_TRADE_METRICS.fields, 'hourly']);
export const TRAFFIC_TODAY_HOURLY_FIELDS = Object.freeze(['hour', ...TODAY_HOURLY_METRICS.fields]);

function flowItem(row) {
  const peers = PEERS.map(([keySuffix, fieldSuffix]) => TRAFFIC_METRICS.project(row, { keySuffix, fieldSuffix }));
  const values = { date: row.statDate ?? null, ...Object.assign({}, ...peers) };
  return Object.fromEntries(TRAFFIC_ITEM_FIELDS.map((key) => [key, values[key]]));
}

// 今日流量与成交来自刷新时点不同的两个接口，各自原样投影，不交叉计算。
function toTodayView(today) {
  if (today === null) return null;
  const { snapshotAt, sources: { flow, trade } } = today;
  const hourly = [...trade].sort((left, right) => left.hr.localeCompare(right.hr));
  const latest = hourly.at(-1) ?? null;
  return { snapshot_at: snapshotAt, as_of_hour: latest?.hr ?? null, ...TODAY_FLOW_METRICS.project(flow),
    ...TODAY_TRADE_METRICS.project(latest),
    hourly: hourly.map((row) => ({ hour: row.hr, ...TODAY_HOURLY_METRICS.project(row) })) };
}

const valueWithUnit = (value, unit) => (value === null ? '未知' : `${value} ${unit}`);

function todayHeadline(today) {
  const visitors = `店铺访客 ${valueWithUnit(today.shop_visitor_count, '人')}`;
  if (today.as_of_hour === null) return `今日暂无成交累计数据，${visitors}`;
  return `今日截至 ${today.as_of_hour} 时累计成交 ${valueWithUnit(today.pay_amount_yuan, '元')}、`
    + `${valueWithUnit(today.pay_order_count, '单')}，${visitors}`;
}

export function toTrafficView(rows, { window, today = null, hints = [], mallId = null }) {
  const items = rows.map(flowItem).sort((left, right) => String(left.date).localeCompare(String(right.date)));
  // 空窗口缺少观测，保持 null；有观测时任一缺项会向合计传播。
  const summary = Object.fromEntries(TRAFFIC_SUMMARY_FIELDS.map((key) =>
    [key, items.length ? round(sumKnown(items.map((item) => item[key]))) : null]));
  const keys = ['daily_uv_sum'];
  if (items.length < window.days) keys.push('missing_days');
  const todayView = toTodayView(today);
  const headline = [`近 ${window.days} 天流量，返回 ${items.length} 个统计日`];
  if (todayView) headline.push(todayHeadline(todayView));
  return { headline, window, items, summary, today: todayView,
    hints: reportHints(TRAFFIC_REPORT, [...keys, ...hints]), mall_id: mallId };
}
