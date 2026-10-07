import { toPct } from '../../infra/units.js';

export function summarizeFunnel({ orderStats, windowDays } = {}) {
  if (!orderStats || !Number.isFinite(orderStats.total)) {
    return {
      status: 'partial',
      issues: [],
      hints: ['需要订单数据才能评估订单履约漏斗'],
      detail: {},
    };
  }

  const total = orderStats.total;
  // 售后字段缺失时 refund_count 为 null：退款数、退款率、履约率均未知，不按 0 计
  const refundCount = orderStats.refund_count == null ? null : Number(orderStats.refund_count);
  const statusDist = orderStats.status_distribution ?? {};
  const known = total > 0 && refundCount != null;
  const fulfillmentRate = known ? (total - refundCount) / total : null;

  const issues = [];
  const hints = [];
  if (total > 0 && refundCount == null) hints.push('订单样本缺少售后状态字段，退款数据不可用');

  return {
    status: 'full',
    issues,
    hints,
    detail: {
      total_orders: total,
      refund_count: refundCount,
      refund_rate_pct: known ? toPct(refundCount / total) : null,
      fulfillment_rate_pct: fulfillmentRate == null ? null : toPct(fulfillmentRate),
      status_distribution: statusDist,
      window_days: windowDays ?? null,
    },
  };
}
