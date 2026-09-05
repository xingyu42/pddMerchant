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
  const refundRate = Number(orderStats.refund_rate ?? 0);
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
      refund_rate: Number(refundRate.toFixed(4)),
      fulfillment_rate: fulfillmentRate == null ? null : Number(fulfillmentRate.toFixed(4)),
      status_distribution: statusDist,
      window_days: windowDays ?? null,
    },
  };
}
