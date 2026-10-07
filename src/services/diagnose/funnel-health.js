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
  const refundCount = Number(orderStats.refund_count ?? 0);
  const statusDist = orderStats.status_distribution ?? {};
  const fulfillmentRate = total > 0 ? (total - refundCount) / total : null;

  const issues = [];
  const hints = [];

  return {
    status: 'full',
    issues,
    hints,
    detail: {
      total_orders: total,
      refund_count: refundCount,
      refund_rate_pct: total > 0 ? toPct(refundCount / total) : null,
      fulfillment_rate_pct: fulfillmentRate == null ? null : toPct(fulfillmentRate),
      status_distribution: statusDist,
      window_days: windowDays ?? null,
    },
  };
}
