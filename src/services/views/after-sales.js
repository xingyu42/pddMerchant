import { AFTER_SALES_VIEW_LIMIT } from '../../adapter/endpoints/after-sales.js';
import { labelOf, toFiniteNumber, toLocalDateTime, toPct, yuanFromFen } from '../../infra/units.js';
import { defineReport, reportHints } from '../operating-report.js';
import { text } from './_shared.js';
import {
  AFTER_SALES_CASE_STATUS_LABEL, AFTER_SALES_FILTER_STATUS_LABEL, AFTER_SALES_FILTER_TYPE_LABEL,
  AFTER_SALES_SHIPPING_STATUS_LABEL, AFTER_SALES_TYPE_LABEL,
} from './labels.js';

export const AFTER_SALES_CASE_FIELDS = Object.freeze([
  'after_sales_id', 'order_sn', 'goods_name', 'spec', 'quantity', 'type', 'status',
  'status_detail', 'shipping_status', 'reason_code', 'reason_desc', 'reason_category',
  'refund_amount_yuan', 'order_amount_yuan', 'receive_amount_yuan', 'created_at', 'closed_at',
  'reverse_tracking_number',
]);
export const REASON_SUMMARY_FIELDS = Object.freeze([
  'reason_desc', 'reason_category', 'count', 'share_pct', 'refund_amount_yuan',
]);
export const AFTER_SALES_WINDOW_FIELDS = Object.freeze(['start_at', 'end_at', 'days']);
export const AFTER_SALES_FILTER_FIELDS = Object.freeze(['sn', 'goods_id', 'status', 'type']);

export const AFTER_SALES_REPORT = defineReport({
  days: {
    min: 1, max: 365, default: 30, separator: '–',
    message: '需为 {range} 的整数',
    description: '售后申请时间窗口天数（{range}，默认 {default}）',
  },
  hints: {
    params_unavailable: '售后参数字典拉取失败，售后原因大类暂不可用',
    list_truncated: `售后单已达单次 ${AFTER_SALES_VIEW_LIMIT} 条上限，结果已截断，建议配合 --since/--until 缩小区间分段拉取`,
  },
});

export function toAfterSalesCaseView(raw, reasonCategoryMap) {
  const reasonCode = toFiniteNumber(raw?.afterSalesReasonCode);
  return {
    after_sales_id: text(raw?.id),
    order_sn: text(raw?.orderSn),
    goods_name: text(raw?.goodsName),
    spec: text(raw?.goodsSpec),
    quantity: toFiniteNumber(raw?.goodsNumber),
    type: text(raw?.afterSalesTypeName) ?? labelOf(AFTER_SALES_TYPE_LABEL, raw?.afterSalesType),
    status: labelOf(AFTER_SALES_CASE_STATUS_LABEL, raw?.afterSalesStatus),
    status_detail: text(raw?.afterSalesTitle),
    shipping_status: text(raw?.sellerAfterSalesShippingStatusDesc)
      ?? labelOf(AFTER_SALES_SHIPPING_STATUS_LABEL, raw?.sellerAfterSalesShippingStatus),
    reason_code: reasonCode,
    reason_desc: text(raw?.afterSalesReasonDesc),
    reason_category: reasonCode == null ? null : reasonCategoryMap?.[String(reasonCode)] ?? null,
    refund_amount_yuan: yuanFromFen(raw?.refundAmount),
    order_amount_yuan: yuanFromFen(raw?.orderAmount),
    receive_amount_yuan: yuanFromFen(raw?.receiveAmount),
    created_at: toLocalDateTime(raw?.createdAt),
    closed_at: toLocalDateTime(raw?.closeTime),
    reverse_tracking_number: text(raw?.reverseTrackingNumber),
  };
}

function buildReasonSummary(rawItems, projectedItems) {
  const groups = new Map();
  for (const [index, item] of projectedItems.entries()) {
    const desc = item.reason_desc ?? (item.reason_code != null ? `未知(${item.reason_code})` : '未知');
    if (!groups.has(desc)) groups.set(desc, { category: item.reason_category, count: 0, refundFen: null });
    const group = groups.get(desc);
    group.count++;
    if (group.category !== item.reason_category) group.category = null;
    const amount = toFiniteNumber(rawItems[index]?.refundAmount);
    if (amount !== null) group.refundFen = (group.refundFen ?? 0) + amount;
  }
  return Array.from(groups, ([desc, { category, count, refundFen }]) => ({
    reason_desc: desc,
    reason_category: category,
    count,
    share_pct: toPct(count / projectedItems.length),
    refund_amount_yuan: yuanFromFen(refundFen),
  })).sort((a, b) => b.count - a.count
    || (b.refund_amount_yuan ?? -Infinity) - (a.refund_amount_yuan ?? -Infinity)
    || a.reason_desc.localeCompare(b.reason_desc));
}

export function toAfterSalesListView({
  rawItems, total, window, reasonCategoryMap, truncated = false, hints = [], mallId = null,
}) {
  const items = rawItems.map((raw) => toAfterSalesCaseView(raw, reasonCategoryMap));
  const fetchedCount = items.length;
  const reasonSummary = buildReasonSummary(rawItems, items);
  const headline = [total === 0 && fetchedCount === 0
    ? `近 ${window.days} 天无售后单`
    : `近 ${window.days} 天售后单 ${total} 条，已采集 ${fetchedCount} 条`];
  if (reasonSummary.length > 0) {
    headline.push(`高频售后原因：${reasonSummary.slice(0, 3).map(({ reason_desc, count, share_pct }) =>
      `${reason_desc} ${count} 条（${share_pct}%）`).join('、')}`);
  }
  if (truncated) headline.push(AFTER_SALES_REPORT.hints.list_truncated);
  return {
    headline,
    window: { start_at: toLocalDateTime(window.startTime), end_at: toLocalDateTime(window.endTime), days: window.days },
    filters: { sn: null, goods_id: null, status: AFTER_SALES_FILTER_STATUS_LABEL.all, type: AFTER_SALES_FILTER_TYPE_LABEL.all },
    total,
    fetched_count: fetchedCount,
    truncated,
    reason_summary: reasonSummary,
    items,
    hints: reportHints(AFTER_SALES_REPORT, hints),
    mall_id: mallId,
  };
}
