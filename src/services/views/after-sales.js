import { labelOf, percentile, round, toFiniteNumber, toLocalDateTime, toPct, yuanFromFen } from '../../infra/units.js';
import { defineReport, reportHints } from '../operating-report.js';
import { text } from './_shared.js';
import {
  DELIVERY_CALIBER, DELIVERY_SOURCE_LABEL, diffDays, isAfterSalesCaseShipped, parseShanghaiDateTimeToSeconds, traceStatusLabel,
} from './logistics.js';

// 售后工作台的售后单状态独立于订单状态；重叠码取细分状态。
const AFTER_SALES_TYPE_LABEL = Object.freeze({
  1: '退款', 2: '退款退货', 3: '换货', 4: '补寄', 5: '维修',
});
const AFTER_SALES_SHIPPING_STATUS_LABEL = Object.freeze({ 0: '未发货', 1: '已发货' });
const AFTER_SALES_CASE_STATUS_LABEL = Object.freeze({
  1: '待商家处理', 14: '待商家处理', 21: '待商家处理', 32: '待商家处理',
  9: '待消费者发货', 10: '待消费者发货', 15: '待消费者发货', 22: '待消费者发货',
  11: '待商家收货',
  2: '平台处理中', 3: '平台处理中', 7: '平台处理中',
  4: '进行中售后单', 18: '进行中售后单', 27: '进行中售后单', 31: '进行中售后单',
  5: '退款成功', 6: '退款关闭', 12: '退款关闭', 16: '换货/补寄成功', 17: '换货/补寄关闭',
  25: '维修成功', 24: '维修关闭',
});
const AFTER_SALES_FILTER_STATUS_LABEL = Object.freeze({
  all: '全部', open: '进行中', refunded: '退款成功', closed: '已关闭',
});
const AFTER_SALES_FILTER_TYPE_LABEL = Object.freeze({
  all: '全部', refund: '退款', return_refund: '退款退货', exchange: '换货', resend: '补寄', repair: '维修',
});

export const AFTER_SALES_CASE_FIELDS = Object.freeze([
  'after_sales_id', 'order_sn', 'goods_name', 'spec', 'quantity', 'type', 'status',
  'status_detail', 'shipping_status', 'reason_code', 'reason_desc', 'reason_category',
  'refund_amount_yuan', 'order_amount_yuan', 'receive_amount_yuan', 'created_at', 'closed_at',
  'reverse_tracking_number',
]);
export const AFTER_SALES_CASE_WITH_DELIVERY_FIELDS = Object.freeze([
  ...AFTER_SALES_CASE_FIELDS,
  'delivery_caliber', 'delivered_at', 'delivery_event',
  'in_cabinet_at', 'signed_at', 'delivery_to_apply_days', 'delivery_source',
]);
export const REASON_SUMMARY_FIELDS = Object.freeze([
  'reason_desc', 'reason_category', 'count', 'share_pct', 'refund_amount_yuan',
]);
export const AFTER_SALES_WINDOW_FIELDS = Object.freeze(['start_at', 'end_at', 'days']);
export const AFTER_SALES_FILTER_FIELDS = Object.freeze(['sn', 'goods_id', 'status', 'type']);
export const AFTER_SALES_DELIVERY_SUMMARY_FIELDS = Object.freeze([
  'caliber', 'shipped_cases_count', 'unique_orders_count', 'measured_cases_count',
  'fetched_orders_count', 'delivered_orders_count', 'in_transit_orders_count',
  'skipped_cap_orders_count', 'skipped_throttled_orders_count', 'failed_orders_count',
  'max_track_fetches', 'capped', 'avg_days', 'p50_days', 'p90_days', 'min_days', 'max_days',
]);

export const AFTER_SALES_REPORT = defineReport({
  days: {
    min: 1, max: 365, default: 30, separator: '–',
    message: '需为 {range} 的整数',
    description: '售后申请时间窗口天数（{range}，默认 {default}）',
  },
  hints: {
    cases_unavailable: '关联售后单拉取失败，售后原因暂不可用',
    params_unavailable: '售后参数字典拉取失败，售后原因大类暂不可用',
    list_truncated: '售后单已达单次 2000 条上限，结果已截断，建议配合 --since/--until 缩小区间分段拉取',
    detail_cases_truncated: '关联售后单检索已达单次 2000 条上限，结果可能不完整',
    delivery_track_capped: '已达单次正向轨迹查询上限，超出部分订单未拉取妥投时间，可调大 --max-track-fetches 或缩小时间窗口',
    delivery_track_partial_failed: '部分订单正向物流轨迹拉取失败，已保留已成功采集的妥投结果',
    delivery_track_rate_limited: '触发平台流控上限，已停止继续拉取正向轨迹，已保留已成功采集的妥投结果',
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

function buildReasonSummary(itemEntries) {
  const groups = new Map();
  for (const { raw, item } of itemEntries) {
    const desc = item.reason_desc ?? (item.reason_code != null ? `未知(${item.reason_code})` : '未知');
    if (!groups.has(desc)) groups.set(desc, { category: item.reason_category, count: 0, refundFen: null });
    const group = groups.get(desc);
    group.count++;
    if (group.category !== item.reason_category) group.category = null;
    const amount = toFiniteNumber(raw?.refundAmount);
    if (amount !== null) group.refundFen = (group.refundFen ?? 0) + amount;
  }
  return Array.from(groups, ([desc, { category, count, refundFen }]) => ({
    reason_desc: desc,
    reason_category: category,
    count,
    share_pct: toPct(count / itemEntries.length),
    refund_amount_yuan: yuanFromFen(refundFen),
  })).sort((a, b) => b.count - a.count
    || (b.refund_amount_yuan ?? -Infinity) - (a.refund_amount_yuan ?? -Infinity)
    || a.reason_desc.localeCompare(b.reason_desc));
}

function resolveDeliverySource(shipped, item, record) {
  if (shipped) {
    const key = record?.source ?? 'untracked';
    return DELIVERY_SOURCE_LABEL[key] ?? key;
  }
  if (item.shipping_status === '未发货') return DELIVERY_SOURCE_LABEL.unshipped;
  return null;
}

function buildDeliverySummary(shippedCasesCount, stats, durations) {
  durations.sort((a, b) => a - b);
  const hasDurations = durations.length > 0;
  return {
    caliber: DELIVERY_CALIBER,
    shipped_cases_count: shippedCasesCount,
    unique_orders_count: stats.unique_orders_count ?? 0,
    measured_cases_count: durations.length,
    fetched_orders_count: stats.fetched_orders_count ?? 0,
    delivered_orders_count: stats.delivered_orders_count ?? 0,
    in_transit_orders_count: stats.in_transit_orders_count ?? 0,
    skipped_cap_orders_count: stats.skipped_cap_orders_count ?? 0,
    skipped_throttled_orders_count: stats.skipped_throttled_orders_count ?? 0,
    failed_orders_count: stats.failed_orders_count ?? 0,
    max_track_fetches: stats.max_track_fetches ?? 0,
    capped: Boolean(stats.capped),
    avg_days: hasDurations ? round(durations.reduce((acc, v) => acc + v, 0) / durations.length, 2) : null,
    p50_days: hasDurations ? round(percentile(durations, 50), 2) : null,
    p90_days: hasDurations ? round(percentile(durations, 90), 2) : null,
    min_days: hasDurations ? round(durations[0], 2) : null,
    max_days: hasDurations ? round(durations[durations.length - 1], 2) : null,
  };
}

function buildDeliveryView(itemEntries, delivery) {
  const byOrderSn = delivery?.byOrderSn instanceof Map ? delivery.byOrderSn : new Map();
  let shippedCasesCount = 0;
  const durations = [];

  const enrichedItems = itemEntries.map(({ raw, item }) => {
    const shipped = isAfterSalesCaseShipped(raw);
    if (shipped) shippedCasesCount++;
    const record = shipped && item.order_sn ? byOrderSn.get(item.order_sn) : null;
    const deliveredAtSec = record?.delivered_at_sec ?? null;
    const deliveryEvent = record?.delivery_event ?? null;
    const applyAtSec = parseShanghaiDateTimeToSeconds(raw?.createdAt);
    const deliveryToApplyDays = diffDays(deliveredAtSec, applyAtSec);
    if (deliveryToApplyDays != null) durations.push(deliveryToApplyDays);

    return {
      ...item,
      delivery_caliber: DELIVERY_CALIBER,
      delivered_at: toLocalDateTime(deliveredAtSec),
      delivery_event: deliveryEvent ? traceStatusLabel(deliveryEvent) : null,
      in_cabinet_at: toLocalDateTime(record?.in_cabinet_at_sec),
      signed_at: toLocalDateTime(record?.signed_at_sec),
      delivery_to_apply_days: deliveryToApplyDays,
      delivery_source: resolveDeliverySource(shipped, item, record),
    };
  });

  return {
    items: enrichedItems,
    delivery: buildDeliverySummary(shippedCasesCount, delivery?.stats ?? {}, durations),
  };
}

function buildAfterSalesHeadline({ selection, total, fetchedCount, reasonSummary, deliveryView, truncated }) {
  const headline = [total === 0 && fetchedCount === 0
    ? `${selection}无售后单`
    : `${selection}售后单 ${total} 条，已采集 ${fetchedCount} 条`];
  if (reasonSummary.length > 0) {
    headline.push(`高频售后原因：${reasonSummary.slice(0, 3).map(({ reason_desc, count, share_pct }) =>
      `${reason_desc} ${count} 条（${share_pct}%）`).join('、')}`);
  }
  if (deliveryView) {
    const s = deliveryView.delivery;
    headline.push(s.measured_cases_count > 0
      ? `收货至发起售后：可度量 ${s.measured_cases_count}/${s.shipped_cases_count} 条，中位 ${s.p50_days} 天、P90 ${s.p90_days} 天、均值 ${s.avg_days} 天（实时查询 ${s.fetched_orders_count} 单，已妥投 ${s.delivered_orders_count} 单）`
      : `收货至发起售后：已发货售后单 ${s.shipped_cases_count} 条，暂无可度量样本（实时查询 ${s.fetched_orders_count} 单，已妥投 ${s.delivered_orders_count} 单）`);
    if (truncated) headline[0] = `${headline[0]}；${AFTER_SALES_REPORT.hints.list_truncated}`;
  } else if (truncated) {
    headline.push(AFTER_SALES_REPORT.hints.list_truncated);
  }
  return headline;
}

export function toAfterSalesListView({
  rawItems, total, window, filters = {}, reasonCategoryMap, truncated = false, hints = [], mallId = null, delivery = null,
}) {
  const itemEntries = rawItems.map((raw) => ({
    raw,
    item: toAfterSalesCaseView(raw, reasonCategoryMap),
  }));
  const fetchedCount = itemEntries.length;
  const reasonSummary = buildReasonSummary(itemEntries);
  const startAt = toLocalDateTime(window.startTime, { unixSeconds: true });
  const endAt = toLocalDateTime(window.endTime, { unixSeconds: true });
  const scope = window.days != null ? `近 ${window.days} 天`
    : window.startTime != null ? `${startAt ?? `Unix 秒 ${window.startTime}`} 至 ${endAt ?? `Unix 秒 ${window.endTime}`}` : '全历史';
  const { sn = null, goodsId = null, status = 'all', type = 'all' } = filters;
  const statusLabel = AFTER_SALES_FILTER_STATUS_LABEL[status];
  const typeLabel = AFTER_SALES_FILTER_TYPE_LABEL[type];
  const descriptors = [
    sn != null ? `订单号 ${sn}` : null,
    goodsId != null ? `商品 ID ${goodsId}` : null,
    status !== 'all' ? `状态：${statusLabel}` : null,
    type !== 'all' ? `类型：${typeLabel}` : null,
  ].filter(Boolean);
  const selection = descriptors.length ? `${scope}（${descriptors.join('、')}）` : scope;
  const deliveryView = delivery != null ? buildDeliveryView(itemEntries, delivery) : null;

  return {
    headline: buildAfterSalesHeadline({ selection, total, fetchedCount, reasonSummary, deliveryView, truncated }),
    window: { start_at: startAt, end_at: endAt, days: window.days },
    filters: { sn, goods_id: goodsId, status: statusLabel, type: typeLabel },
    total,
    fetched_count: fetchedCount,
    truncated,
    reason_summary: reasonSummary,
    ...(deliveryView ? { delivery: deliveryView.delivery } : {}),
    items: deliveryView ? deliveryView.items : itemEntries.map(({ item }) => item),
    hints: reportHints(AFTER_SALES_REPORT, hints),
    mall_id: mallId,
  };
}
