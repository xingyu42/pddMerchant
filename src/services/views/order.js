// 订单领域视图（输出契约 v2 防腐层）：白名单投影上游订单对象，上游其余字段一律丢弃。
// 字段依据 research/upstream-schema-2026-10.md §1–§2：金额为分、时间为 unix 秒（0 = 未发生）。
// 收件人 / 联系方式 / 地址等 PII 不进入视图（D5）。
import { labelOf, round, toFiniteNumber, toLocalDateTime, toPct, yuanFromFen } from '../../infra/units.js';
import { pick, text } from './_shared.js';
import { AFTER_SALES_STATUS_LABEL } from './labels.js';

export const ORDER_VIEW_FIELDS = Object.freeze([
  'order_sn', 'status', 'goods_id', 'goods_name', 'spec', 'quantity',
  'unit_price_yuan', 'goods_amount_yuan', 'merchant_discount_yuan', 'platform_discount_yuan',
  'shipping_fee_yuan', 'paid_amount_yuan',
  'ordered_at', 'ship_deadline_at', 'shipped_at',
  'express_company', 'tracking_number', 'buyer_memo', 'after_sales_status',
]);

export const ORDER_DETAIL_VIEW_FIELDS = Object.freeze([
  ...ORDER_VIEW_FIELDS, 'paid_at', 'grouped_at', 'received_at', 'invoice_status',
]);

// 状态标签以上游 order_status_str 为准；缺失时回退 '未知(<order_status>)'，不自建状态码表
export function orderStatusLabel(raw) {
  return text(raw?.order_status_str) ?? labelOf({}, pick(raw, ['order_status', 'orderStatus']));
}

function expressCompany(raw) {
  return text(raw?.shipping_name) ?? text(raw?.waybillDTOList?.[0]?.shippingName);
}

export function toOrderView(raw) {
  return {
    order_sn: text(pick(raw, ['order_sn', 'orderSn'])),
    status: orderStatusLabel(raw),
    goods_id: text(raw?.goods_id),
    goods_name: text(raw?.goods_name),
    spec: text(raw?.spec),
    quantity: toFiniteNumber(raw?.goods_number),
    unit_price_yuan: yuanFromFen(raw?.goods_price),
    goods_amount_yuan: yuanFromFen(raw?.goods_amount),
    merchant_discount_yuan: yuanFromFen(raw?.merchant_discount),
    platform_discount_yuan: yuanFromFen(raw?.platform_discount),
    shipping_fee_yuan: yuanFromFen(raw?.shipping_amount),
    paid_amount_yuan: yuanFromFen(raw?.order_amount),
    ordered_at: toLocalDateTime(pick(raw, ['order_time', 'orderTime'])),
    ship_deadline_at: toLocalDateTime(raw?.promise_shipping_time),
    shipped_at: toLocalDateTime(raw?.shipping_time),
    express_company: expressCompany(raw),
    tracking_number: text(raw?.tracking_number),
    buyer_memo: text(raw?.buyer_memo),
    // 售后状态码表见 labels.js（research order-list-filters-2026-10-08 §3）；未登记码输出 '未知(<code>)'
    after_sales_status: labelOf(AFTER_SALES_STATUS_LABEL, raw?.after_sales_status),
  };
}

export function toOrderDetailView(raw) {
  return {
    ...toOrderView(raw),
    paid_at: toLocalDateTime(raw?.pay_time),
    grouped_at: toLocalDateTime(raw?.group_time),
    received_at: toLocalDateTime(raw?.receive_time),
    invoice_status: text(raw?.invoice_apply_status_str),
  };
}

// statisticWithType 计数（research §2）
export function toRemoteOrderStatsView(remote) {
  return {
    pending_ship_count: remote.unship,
    pending_ship_over_12h_count: remote.unship12h,
    delayed_ship_count: remote.delay,
    pending_receipt_count: remote.unreceive,
  };
}

function secondsToHours(seconds) {
  return seconds == null ? null : round(seconds / 3600, 1);
}

// computeOrderStats 结果 → v2：秒 → 小时（1 位），比率 → 百分数；
// 无样本或售后字段缺失时比率为 null 而非 0；售后字段缺失时退款 / 售后计数同为 null
export function toLocalOrderStatsView(stats) {
  const shipping = stats.shipping_seconds;
  return {
    order_count: stats.total,
    status_distribution: stats.status_distribution,
    ship_samples: shipping.samples,
    ship_p50_hours: secondsToHours(shipping.p50),
    ship_p95_hours: secondsToHours(shipping.p95),
    refund_count: stats.refund_count,
    after_sales_count: stats.after_sales_count,
    refund_rate_pct: stats.refund_rate == null ? null : toPct(stats.refund_rate),
  };
}
