import { round, toFiniteNumber } from '../../infra/units.js';
import { metricTable } from '../../infra/metrics.js';
import { defineReport, reportHints } from '../operating-report.js';
import { valueWithUnit } from './_shared.js';

export const GOODS_TRAFFIC_REPORT = defineReport({
  days: { choices: { 1: 0, 7: 1, 30: 2 }, default: 30, message: '--days 仅接受 {range}',
    description: '平台原生区间（{range} 天）' },
  hints: {
    promo_caliber: '推广拆分口径来自对第三方插件实现的分析，尚未经有投放店铺实测',
    non_promo_caliber: '非推广成交 = 商品明细总量减去推广直接成交，平台不提供该拆分',
    goods_truncated: '商品明细采集不完整（分页上限或提前空页），结果已截断',
    promo_unavailable: '推广数据拉取失败或已达采集上限，推广及非推广成交字段为 null',
    negative_difference: '总成交减去推广直接成交出现负差额，对应非推广成交字段为 null',
    promo_unknown_unit: '推广金额单位未知，对应推广金额及非推广成交额为 null',
    today_unavailable: '今日实时数据拉取失败，today 为 null，历史商品明细不受影响',
  },
});

const GOODS_TRAFFIC_METRICS = metricTable([
  ['visitor_count', 'goodsUv', 'count'], ['page_view_count', 'goodsPv', 'count'], ['fav_user_count', 'goodsFavCnt', 'count'],
  ['order_create_user_count', 'ordrCrtUsrCnt', 'count'], ['order_rate_pct', 'ordrVstrRto', 'ratio'],
  ['pay_conversion_pct', 'goodsVcr', 'ratio'], ['pay_rate_pct', 'payOrdrRto', 'ratio'],
  ['pay_order_count', 'payOrdrCnt', 'count'], ['pay_goods_qty', 'payOrdrGoodsQty', 'count'], ['pay_buyer_count', 'payOrdrUsrCnt', 'count'],
  ['pay_amount_yuan', 'payOrdrAmt', 'yuan'], ['consult_user_count', 'cnsltUsrQty', 'count'],
]);
const GOODS_TRAFFIC_PROMO_METRICS = metricTable([
  ['promo_direct_order_count', 'directOrderNum', 'count'], ['promo_indirect_order_count', 'indirectOrderNum', 'count'],
  ['promo_direct_amount_yuan', 'directAmountFen', 'fen'], ['promo_indirect_amount_yuan', 'indirectAmountFen', 'fen'],
  ['promo_spend_yuan', 'spendFen', 'fen'], ['promo_click_count', 'click', 'count'],
  ['non_promo_order_count', 'nonPromoOrders', 'count'], ['non_promo_amount_yuan', 'nonPromoAmountFen', 'fen'],
]);
const GOODS_TODAY_OVERVIEW_SPEC = Object.freeze([
  ['goods_visitor_count', 'guvRt', 'count'], ['goods_page_view_count', 'gpvRt', 'count'],
  ['visited_goods_count', 'vstGoodsCntRt', 'count'], ['pay_order_count', 'payOrdrCntRt', 'count'],
  ['pay_amount_yuan', 'payOrdrAmtRt', 'yuan'], ['pay_conversion_pct', 'payUvRtoRt', 'pct_string'],
]);
const GOODS_TODAY_SINGLE_METRICS = metricTable([
  ['visitor_count', 'goodsUv', 'count'], ['page_view_count', 'goodsPv', 'count'],
  ['fav_user_count', 'goodsFavCnt', 'count'], ['impression_user_count', 'imprUsrCnt', 'count'],
  ['order_rate_pct', 'ordrVstrRto', 'ratio'], ['pay_conversion_pct', 'goodsVcr', 'ratio'],
  ['pay_rate_pct', 'payOrdrRto', 'ratio'], ['pay_order_count', 'payOrdrCnt', 'count'],
  ['pay_goods_qty', 'payOrdrGoodsQty', 'count'], ['pay_buyer_count', 'payOrdrUsrCnt', 'count'],
  ['pay_amount_yuan', 'payOrdrAmt', 'yuan'], ['consult_user_count', 'cnsltUsrQty', 'count'],
]);

export const GOODS_TRAFFIC_PROMO_FIELDS = GOODS_TRAFFIC_PROMO_METRICS.fields;
export const GOODS_TRAFFIC_ITEM_FIELDS = Object.freeze(['goods_id', 'goods_name', ...GOODS_TRAFFIC_METRICS.fields,
  'category', ...GOODS_TRAFFIC_PROMO_FIELDS]);
export const GOODS_TRAFFIC_TODAY_OVERVIEW_FIELDS = Object.freeze(['snapshot_at',
  ...GOODS_TODAY_OVERVIEW_SPEC.map(([key]) => key)]);
export const GOODS_TRAFFIC_TODAY_SINGLE_FIELDS = Object.freeze(['snapshot_at', 'as_of_hour',
  ...GOODS_TODAY_SINGLE_METRICS.fields, 'hourly']);
export const GOODS_TRAFFIC_TODAY_HOURLY_FIELDS = Object.freeze(['hour', ...GOODS_TODAY_SINGLE_METRICS.fields]);

const FORMATTED_NUMBER = /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;

function parseFormattedNumber(value) {
  let num = null;
  if (typeof value === 'number') {
    num = Number.isFinite(value) ? value : null;
  } else if (typeof value === 'string') {
    const text = value.trim();
    if (FORMATTED_NUMBER.test(text)) num = toFiniteNumber(text.replaceAll(',', ''));
  }
  return Object.is(num, -0) ? 0 : num;
}

function parseFormattedPercent(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text.endsWith('%')) return null;
  const num = parseFormattedNumber(text.slice(0, -1).trim());
  return num === null ? null : round(num, 2);
}

function parseOverviewField(row, rawKey, outputKey, kind, warnings) {
  const raw = row?.[rawKey];
  if (raw === null || raw === undefined) return null;
  let parsed = null;
  if (kind === 'pct_string') parsed = parseFormattedPercent(raw);
  else if (kind === 'yuan') {
    const num = parseFormattedNumber(raw);
    parsed = num === null ? null : round(num, 2);
  } else {
    parsed = parseFormattedNumber(raw);
  }
  if (parsed === null) {
    warnings.push({
      code: 'goods_today_parse_failed',
      field: outputKey,
      message: `全店商品今日实时字段 ${outputKey} 格式无法解析，已置为 null`,
    });
  }
  return parsed;
}

function toOverviewTodayView(snapshotAt, overview, warnings) {
  const fields = Object.fromEntries(GOODS_TODAY_OVERVIEW_SPEC.map(([outputKey, rawKey, kind]) =>
    [outputKey, parseOverviewField(overview, rawKey, outputKey, kind, warnings)]));
  return { snapshot_at: snapshotAt, ...fields };
}

function toSingleTodayView(snapshotAt, stat) {
  const rows = [...(stat?.hourly ?? [])].sort((left, right) => left.statHr.localeCompare(right.statHr));
  const latest = rows.at(-1) ?? null;
  return {
    snapshot_at: snapshotAt,
    as_of_hour: latest?.statHr ?? null,
    ...GOODS_TODAY_SINGLE_METRICS.project(stat?.detail),
    hourly: rows.map((row) => ({ hour: row.statHr, ...GOODS_TODAY_SINGLE_METRICS.project(row) })),
  };
}

function toGoodsTodayView(today, warnings) {
  if (today === null) return null;
  if (today.sources?.kind === 'single') return toSingleTodayView(today.snapshotAt, today.sources.stat);
  return toOverviewTodayView(today.snapshotAt, today.sources?.overview, warnings);
}

function todayHeadline(today, goodsId) {
  if (!goodsId) {
    return `今日全店商品访客 ${valueWithUnit(today.goods_visitor_count, '人')}，`
      + `有访问商品 ${valueWithUnit(today.visited_goods_count, '个')}，`
      + `成交 ${valueWithUnit(today.pay_amount_yuan, '元')}、${valueWithUnit(today.pay_order_count, '单')}`;
  }
  const summary = `商品 ${goodsId} 今日实时访客 ${valueWithUnit(today.visitor_count, '人')}，`
    + `成交 ${valueWithUnit(today.pay_amount_yuan, '元')}、${valueWithUnit(today.pay_order_count, '单')}`;
  return today.as_of_hour === null ? `${summary}，暂无小时累计数据` : `${summary}，小时序列截至 ${today.as_of_hour} 时`;
}

export function toGoodsTrafficItem(row, promo = {}) {
  return { goods_id: row.goodsId == null ? null : String(row.goodsId), goods_name: row.goodsName ?? null,
    ...GOODS_TRAFFIC_METRICS.project(row),
    category: row.cate3Name ?? null,
    ...GOODS_TRAFFIC_PROMO_METRICS.project(promo) };
}

export function toGoodsTrafficView(rows, { window, goodsId, total, today = null, quality, promotions,
  hints, mallId, warnings = [] }) {
  const todayView = toGoodsTodayView(today, warnings);
  const headline = [`近 ${window.days} 天商品流量，共 ${total} 个商品，返回 ${rows.length} 条明细`];
  if (todayView) headline.push(todayHeadline(todayView, goodsId));
  return { headline, window, filter_goods_id: goodsId ?? null,
    items: rows.map((row) => toGoodsTrafficItem(row, promotions.get(String(row.goodsId)))),
    total, today: todayView, data_quality: quality,
    hints: reportHints(GOODS_TRAFFIC_REPORT, [...new Set(hints)]), mall_id: mallId };
}
