import { yuanFromFen, isoToLocalDateTime, toLocalDateTime, labelOf } from '../../infra/units.js';
import { DATA_STATUS_LABEL } from './labels.js';
import { defineReport, reportHints } from '../operating-report.js';

export const GOODS_PROFIT_REPORT = defineReport({
  days: { min: 1, max: 90, default: 30, separator: '–', message: '--days 需要 {range} 的整数，默认 {default}',
    description: '成团时间窗口，{range} 个完整上海自然日' },
  hints: {
    orders_truncated: '订单量超出采集上限，窗口财务金额为 null，保留已观测样本',
    orders_ratelimited: '订单采集因限流中断，窗口财务金额为 null，保留已观测样本',
    invalid_order_window: '成团时间缺失或重复订单事实冲突，订单采集不完整',
    promo_incomplete: '推广采集不完整，相关推广花费和净利润为 null',
    promo_unavailable: '推广数据拉取失败，相关推广花费和净利润为 null',
    negative_promo_difference: '推广报表总计减商品归属合计的差额为负，店铺级推广花费为 null',
    promo_amount_unknown: '推广金额缺失或单位无效，相关金额为 null',
  },
});
const PROFIT_FIXED_HINTS = Object.freeze([
  '成本按当前录入值计算，历史窗口会随成本更新重算',
  '退款成功按全额退款且货已退回处理；仅退款不退货时，利润可能高估',
  '平台优惠按全部结算给商家计入收入；商家共担补贴活动时，利润可能高估',
  '推广花费仅含商品推广报表口径',
]);

const COMMON_FIELDS = [
  'order_count', 'observed_order_count', 'quantity', 'refunded_order_count',
  'after_sales_order_count', 'after_sales_revenue_yuan', 'paid_amount_yuan', 'platform_discount_yuan',
  'revenue_yuan', 'observed_revenue_yuan', 'purchase_yuan', 'packaging_yuan', 'courier_yuan',
  'insurance_yuan', 'technical_service_yuan', 'merchant_cost_yuan', 'gross_profit_yuan',
  'promo_spend_yuan', 'net_profit_yuan', 'gross_margin_pct', 'net_margin_pct',
  'cost_updated_at', 'default_fallback_order_count', 'missing_entry_order_count', 'data_status',
];
export const GOODS_PROFIT_ITEM_FIELDS = Object.freeze(['goods_id', 'goods_name', ...COMMON_FIELDS]);
export const GOODS_PROFIT_SUMMARY_FIELDS = Object.freeze(['goods_count', ...COMMON_FIELDS,
  'attributed_promo_spend_yuan', 'shop_promo_spend_yuan', 'unattributed_order_count', 'data_quality']);
export const GOODS_PROFIT_QUALITY_FIELDS = Object.freeze(['orders_complete', 'orders_truncated', 'orders_ratelimited',
  'promo_complete', 'promo_truncated', 'promo_ratelimited']);

function project(record, fields) {
  return Object.fromEntries(fields.map((field) => {
    if (field.endsWith('_yuan')) return [field, yuanFromFen(record[field.replace(/_yuan$/, '_fen')])];
    if (field === 'cost_updated_at') return [field, isoToLocalDateTime(record.cost_updated_at)];
    if (field === 'data_status') return [field, labelOf(DATA_STATUS_LABEL, record.data_status)];
    return [field, record[field] ?? null];
  }));
}

function profitHints(summary, reasons, goodsId) {
  const hints = [...PROFIT_FIXED_HINTS, ...reportHints(GOODS_PROFIT_REPORT, reasons)];
  if (summary.missing_entry_order_count > 0) hints.push(`已观测订单中 ${summary.missing_entry_order_count} 单缺少匹配成本，相关利润为 null`);
  if (summary.default_fallback_order_count > 0) hints.push(`已观测订单中 ${summary.default_fallback_order_count} 单规格未命中，回落商品默认成本`);
  if (summary.unattributed_order_count > 0) hints.push(`已观测订单中 ${summary.unattributed_order_count} 单缺少商品 ID，全店利润为 null`);
  if (summary.after_sales_order_count === null) hints.push('售后字段缺失或状态未知，相关金额为 null');
  if (summary.net_profit_fen === null) hints.push('部分所需订单、成本或推广字段不可用，相关财务金额为 null');
  if (goodsId !== null) hints.push('商品 ID 仅筛选列表，summary 保持全店合计');
  return [...new Set(hints)];
}

function profitHeadline(items, summary, window, quality, goodsId) {
  let first = `${window.startDate} 至 ${window.endDate} 统计商品 ${items.length} 件，订单 ${summary.order_count} 单（全店）`;
  if (!quality.orders_complete) first = `已采集订单 ${summary.observed_order_count} 单，商品 ${items.length} 件`;
  else if (items.length === 0) first = '统计窗口内无订单和商品归属推广记录';
  if (goodsId !== null) first += '，商品列表按 ID 筛选';
  const finance = summary.net_profit_yuan === null ? '全店利润数据不完整，相关金额为 null'
    : `全店收入 ${summary.revenue_yuan} 元，净利润 ${summary.net_profit_yuan} 元`;
  const afterSales = summary.refunded_order_count === null || summary.after_sales_order_count === null
    ? '售后数据部分不可用' : `退款成功 ${summary.refunded_order_count} 单，售后处理中 ${summary.after_sales_order_count} 单`;
  return [first, finance, afterSales];
}

export function toGoodsProfitView(analysis, { window, quality, mallId, goodsId = null, reasons = [] }) {
  const items = analysis.items.map((item) => project(item, GOODS_PROFIT_ITEM_FIELDS));
  const summary = project(analysis.summary, GOODS_PROFIT_SUMMARY_FIELDS);
  summary.data_quality = Object.fromEntries(GOODS_PROFIT_QUALITY_FIELDS.map((field) => [field, Boolean(quality[field])]));
  return {
    headline: profitHeadline(items, summary, window, quality, goodsId),
    window: { start_at: toLocalDateTime(window.start), end_at: toLocalDateTime(window.end), days: window.days },
    filter_goods_id: goodsId, items, total: items.length, summary,
    hints: profitHints(analysis.summary, reasons, goodsId), mall_id: mallId,
  };
}
