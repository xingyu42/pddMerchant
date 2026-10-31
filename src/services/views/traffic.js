import { round, toPct, toFiniteNumber } from '../../infra/units.js';
import { TRAFFIC_HINT_LABEL } from './labels.js';

const METRICS = [
  ['shop_visitor_count', 'uv'], ['shop_page_view_count', 'pv'], ['goods_visitor_count', 'guv'],
  ['goods_page_view_count', 'gpv'], ['pay_buyer_count', 'payOrdrUsrCnt'], ['pay_order_count', 'payOrdrCnt'],
  ['pay_amount_yuan', 'payOrdrAmt', round], ['pay_conversion_pct', 'payUvRto', toPct],
  ['avg_order_value_yuan', 'payOrdrAup', round], ['uv_value_yuan', 'uvCfmVal', round],
];
const PEERS = [['', ''], ['_peer_avg', '1dPln'], ['_peer_excellent', '1dOst']];
export const TRAFFIC_ITEM_FIELDS = Object.freeze(['date', ...METRICS.flatMap(([key]) => PEERS.map(([suffix]) => key + suffix))]);
export const TRAFFIC_SUMMARY_FIELDS = Object.freeze(['shop_visitor_count', 'pay_order_count', 'pay_amount_yuan']);

function flowItem(row) {
  return { date: row.statDate ?? null, ...Object.fromEntries(METRICS.flatMap(([key, field, convert = toFiniteNumber]) =>
    PEERS.map(([suffix, sourceSuffix]) => [key + suffix, convert(row[field + sourceSuffix])]))) };
}

// No returned day means no observation, so the sum is unknown (null), never 0.
function total(items, key) {
  if (items.length === 0 || items.some((item) => item[key] === null)) return null;
  return round(items.reduce((sum, item) => sum + item[key], 0));
}

export function toTrafficView(rows, { window, mallId = null }) {
  const items = rows.map(flowItem).sort((left, right) => String(left.date).localeCompare(String(right.date)));
  const summary = Object.fromEntries(TRAFFIC_SUMMARY_FIELDS.map((key) => [key, total(items, key)]));
  const hints = [TRAFFIC_HINT_LABEL.daily_uv_sum];
  if (items.length < window.days) hints.push(TRAFFIC_HINT_LABEL.missing_days);
  return { headline: [`近 ${window.days} 天流量，返回 ${items.length} 个统计日`], window, items, summary,
    hints, mall_id: mallId };
}
