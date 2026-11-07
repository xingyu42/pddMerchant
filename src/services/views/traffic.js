import { round } from '../../infra/units.js';
import { metricTable, sumKnown } from '../../infra/metrics.js';
import { defineReport, reportHints } from '../operating-report.js';

export const TRAFFIC_REPORT = defineReport({
  days: { min: 1, max: 30, default: 30, message: '--days 需为 {range} 的整数',
    description: '窗口天数（{range}，截至平台就绪日期）' },
  hints: {
    daily_uv_sum: '访客汇总为逐日访客数之和，跨日存在重复访客',
    missing_days: '返回的统计日少于窗口天数，summary 仅汇总已返回的统计日',
  },
});

export const TRAFFIC_METRICS = metricTable([
  ['shop_visitor_count', 'uv', 'count'], ['shop_page_view_count', 'pv', 'count'], ['goods_visitor_count', 'guv', 'count'],
  ['goods_page_view_count', 'gpv', 'count'], ['pay_buyer_count', 'payOrdrUsrCnt', 'count'], ['pay_order_count', 'payOrdrCnt', 'count'],
  ['pay_amount_yuan', 'payOrdrAmt', 'yuan'], ['pay_conversion_pct', 'payUvRto', 'ratio'],
  ['avg_order_value_yuan', 'payOrdrAup', 'yuan'], ['uv_value_yuan', 'uvCfmVal', 'yuan'],
]);
const PEERS = [['', ''], ['_peer_avg', '1dPln'], ['_peer_excellent', '1dOst']];
export const TRAFFIC_ITEM_FIELDS = Object.freeze(['date', ...TRAFFIC_METRICS.fields.flatMap((key) => PEERS.map(([suffix]) => key + suffix))]);
export const TRAFFIC_SUMMARY_FIELDS = Object.freeze(['shop_visitor_count', 'pay_order_count', 'pay_amount_yuan']);

function flowItem(row) {
  const peers = PEERS.map(([keySuffix, fieldSuffix]) => TRAFFIC_METRICS.project(row, { keySuffix, fieldSuffix }));
  const values = { date: row.statDate ?? null, ...Object.assign({}, ...peers) };
  return Object.fromEntries(TRAFFIC_ITEM_FIELDS.map((key) => [key, values[key]]));
}

export function toTrafficView(rows, { window, mallId = null }) {
  const items = rows.map(flowItem).sort((left, right) => String(left.date).localeCompare(String(right.date)));
  // 空窗口缺少观测，保持 null；有观测时任一缺项会向合计传播。
  const summary = Object.fromEntries(TRAFFIC_SUMMARY_FIELDS.map((key) =>
    [key, items.length ? round(sumKnown(items.map((item) => item[key]))) : null]));
  const hints = ['daily_uv_sum'];
  if (items.length < window.days) hints.push('missing_days');
  return { headline: [`近 ${window.days} 天流量，返回 ${items.length} 个统计日`], window, items, summary,
    hints: reportHints(TRAFFIC_REPORT, hints), mall_id: mallId };
}
