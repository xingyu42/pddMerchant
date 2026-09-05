export function summarizeOrders({ stats, listStats } = {}) {
  const issues = [];
  const hints = [];

  if (!stats && !listStats) {
    return {
      status: 'partial',
      issues: ['orders 数据缺失'],
      hints: ['执行 pdd orders stats 采集数据'],
      detail: {},
    };
  }

  const detail = {};
  if (!stats) hints.push('订单计数数据缺失');
  if (!listStats) hints.push('订单列表统计缺失');

  const p95Seconds = listStats?.shipping_seconds?.p95;
  if (typeof p95Seconds === 'number') {
    const p95Hours = p95Seconds / 3600;
    detail.shipping_p95_hours = Number(p95Hours.toFixed(2));
  } else {
    detail.shipping_p95_hours = null;
    hints.push('已发货样本不足，无法计算 P95');
  }

  const refundRate = listStats?.refund_rate;
  if (typeof refundRate === 'number') {
    detail.refund_rate = Number(refundRate.toFixed(4));
  }

  if (stats) {
    const unship = Number(stats.unship ?? 0);
    const delay = Number(stats.delay ?? 0);
    detail.unship = unship;
    detail.delay = delay;
  }

  return {
    status: stats && listStats ? 'full' : 'partial',
    issues,
    hints,
    detail,
  };
}
