export function scoreFunnelHealth({ orderStats, windowDays } = {}) {
  if (!orderStats || typeof orderStats.total !== 'number' || orderStats.total === 0) {
    return {
      score: null,
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
  const fulfillmentRate = total > 0 ? (total - refundCount) / total : 0;

  const issues = [];
  const hints = [];
  let score = 100;

  if (refundRate > 0.15) {
    score -= 60;
    issues.push(`退款率 ${(refundRate * 100).toFixed(1)}%（>15%）`);
    hints.push('排查高退款商品或物流问题，审视售后政策');
  } else if (refundRate > 0.05) {
    score -= 30;
    issues.push(`退款率 ${(refundRate * 100).toFixed(1)}%（>5%）`);
    hints.push('关注退款趋势并核对典型退款原因');
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  const status = finalScore >= 80 ? 'green' : finalScore >= 50 ? 'yellow' : 'red';

  return {
    score: finalScore,
    status,
    issues,
    hints,
    detail: {
      total_orders: total,
      refund_count: refundCount,
      refund_rate: Number(refundRate.toFixed(4)),
      fulfillment_rate: Number(fulfillmentRate.toFixed(4)),
      status_distribution: statusDist,
      window_days: windowDays ?? null,
    },
  };
}
