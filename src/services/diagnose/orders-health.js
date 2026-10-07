import { round, toPct } from '../../infra/units.js';

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
    detail.shipping_p95_hours = round(p95Seconds / 3600, 1);
  } else {
    detail.shipping_p95_hours = null;
    hints.push('已发货样本不足，无法计算 P95');
  }

  // 无订单样本时退款率无分母 → null
  const refundRate = listStats?.refund_rate;
  if (typeof refundRate === 'number') {
    detail.refund_rate_pct = listStats.total > 0 ? toPct(refundRate) : null;
  }

  if (stats) {
    detail.pending_ship_count = Number(stats.unship ?? 0);
    detail.delayed_ship_count = Number(stats.delay ?? 0);
  }

  return {
    status: stats && listStats ? 'full' : 'partial',
    issues,
    hints,
    detail,
  };
}
