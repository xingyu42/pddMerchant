// 诊断视图（输出契约 v2）：summarize* 的内部结果 → 中文状态标签 + headline。
// 内部 status 仍为 'full' / 'partial'（spec 定义值），仅在此处翻译；只陈述事实与数据完整性，不做评价。
import { labelOf, toLocalDate } from '../../infra/units.js';
import { yuanText } from './_shared.js';
import {
  COMPARE_NOTE_LABEL, DATA_STATUS_LABEL, DIMENSION_LABEL, MATCHED_BY_LABEL,
} from './labels.js';

export const DIAGNOSE_DIMENSIONS = Object.freeze(['orders', 'inventory', 'promo', 'funnel']);

export const STALE_SAMPLE_FIELDS = Object.freeze(['goods_id', 'goods_name', 'quantity']);
export const AMBIGUOUS_GROUP_FIELDS = Object.freeze(['normalized_name', 'sku_count', 'sample_quantities']);

function pct(value) {
  return value == null ? '无法计算' : `${value}%`;
}

function ordersHeadline({ detail }) {
  const lines = [];
  if (detail.pending_ship_count != null) {
    lines.push(`待发货 ${detail.pending_ship_count} 单，延迟发货 ${detail.delayed_ship_count} 单`);
  }
  if (detail.shipping_p95_hours != null) lines.push(`下单至发货时长 P95 ${detail.shipping_p95_hours} 小时`);
  if (detail.refund_rate_pct !== undefined) {
    lines.push(detail.refund_rate_pct == null ? '样本退款数据不可用' : `样本退款率 ${detail.refund_rate_pct}%`);
  }
  return lines.length > 0 ? lines : ['订单数据缺失'];
}

function inventoryHeadline({ detail }) {
  if (detail.total == null) return ['商品数据缺失'];
  const lines = [`统计商品 ${detail.total} 件：缺货 ${detail.out_of_stock_count} 件，库存低于 ${detail.low_stock_threshold} 的 ${detail.low_stock_count} 件`];
  lines.push(detail.stale_count == null ? '零销量统计未计算（订单数据不完整）' : `近 30 天零销量且有库存的商品 ${detail.stale_count} 件`);
  return lines;
}

function promoHeadline({ detail }) {
  if (detail.impression == null) return ['推广数据缺失'];
  const roi = detail.roi == null ? 'ROI 无法计算' : `ROI ${detail.roi}`;
  return [
    `推广花费 ${yuanText(detail.spend_yuan, '未记录')}，成交 ${yuanText(detail.gmv_yuan, '未记录')}，${roi}`,
    `曝光 ${detail.impression} 次，点击 ${detail.click} 次，点击率 ${pct(detail.ctr_pct)}`,
  ];
}

function funnelHeadline({ detail }) {
  if (detail.total_orders == null) return ['订单数据缺失'];
  const window = detail.window_days == null ? '' : `近 ${detail.window_days} 天`;
  if (detail.refund_count == null) return [`${window}订单 ${detail.total_orders} 单，退款数据不可用`];
  return [`${window}订单 ${detail.total_orders} 单，退款 ${detail.refund_count} 单（退款率 ${pct(detail.refund_rate_pct)}）`];
}

const HEADLINES = { orders: ordersHeadline, inventory: inventoryHeadline, promo: promoHeadline, funnel: funnelHeadline };

function toDetailView(name, detail = {}) {
  if (name !== 'inventory' || !('matched_by' in detail)) return detail;
  return { ...detail, matched_by: labelOf(MATCHED_BY_LABEL, detail.matched_by) };
}

// 单维度：{ headline, status, detail, issues, hints }；status 不完整时 headline 末尾说明
export function toDimensionView(name, result) {
  const status = labelOf(DATA_STATUS_LABEL, result.status);
  const headline = HEADLINES[name](result).slice(0, 2);
  if (result.status !== 'full') headline.push(`${DIMENSION_LABEL[name]}${status}，详见 hints`);
  return {
    headline,
    status,
    detail: toDetailView(name, result.detail),
    issues: result.issues ?? [],
    hints: result.hints ?? [],
  };
}

function toWindowView(window) {
  return { start_date: toLocalDate(window.since), end_date: toLocalDate(window.until), days: window.days };
}

function toMetricView(metric) {
  const { note, ...values } = metric;
  return note ? { ...values, note: labelOf(COMPARE_NOTE_LABEL, note) } : values;
}

export function toCompareView(compare) {
  const dimensions = {};
  for (const [name, { metrics }] of Object.entries(compare.dimensions ?? {})) {
    const out = {};
    for (const [key, metric] of Object.entries(metrics ?? {})) out[key] = toMetricView(metric);
    dimensions[name] = { metrics: out };
  }
  return {
    status: labelOf(DATA_STATUS_LABEL, compare.status),
    current_window: toWindowView(compare.current_window),
    previous_window: toWindowView(compare.previous_window),
    dimensions,
  };
}

function withDimensionLabel(entries) {
  return entries.map((entry) => ({ ...entry, dimension: labelOf(DIMENSION_LABEL, entry.dimension) }));
}

function shopHeadline(result, compare) {
  const incomplete = DIAGNOSE_DIMENSIONS.filter((name) => result.dimensions[name].status !== 'full');
  const complete = DIAGNOSE_DIMENSIONS.length - incomplete.length;
  const headline = [incomplete.length === 0
    ? `${DIAGNOSE_DIMENSIONS.length} 个维度数据均完整`
    : `${DIAGNOSE_DIMENSIONS.length} 个维度中 ${complete} 个数据完整；不完整：${incomplete.map((name) => DIMENSION_LABEL[name]).join('、')}`];
  if (compare) {
    const { current_window: cur, previous_window: prev } = compare;
    headline.push(`对比区间：本期 ${cur.start_date} 至 ${cur.end_date}，上期 ${prev.start_date} 至 ${prev.end_date}`);
  }
  return headline;
}

// diagnoseShop 结果（可含内部 compare）→ v2
export function toShopView(result, { mallId = null } = {}) {
  const dimensions = {};
  for (const name of DIAGNOSE_DIMENSIONS) dimensions[name] = toDimensionView(name, result.dimensions[name]);
  const compare = result.compare ? toCompareView(result.compare) : undefined;
  return {
    headline: shopHeadline(result, compare),
    status: labelOf(DATA_STATUS_LABEL, result.status),
    dimensions,
    issues: withDimensionLabel(result.issues ?? []),
    hints: withDimensionLabel(result.hints ?? []),
    ...(compare ? { compare } : {}),
    mall_id: mallId,
  };
}
