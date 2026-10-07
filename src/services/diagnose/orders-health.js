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

  // 无订单样本（无分母）或售后字段缺失时退款率 → null，不按 0 计
  let refundUnknownReason = null;
  if (listStats) {
    const refundRate = listStats.refund_rate;
    detail.refund_rate_pct = typeof refundRate === 'number' && listStats.total > 0 ? toPct(refundRate) : null;
    refundUnknownReason = refundReasonOf(listStats, detail.refund_rate_pct);
    if (refundUnknownReason === 'field_missing') hints.push('订单样本缺少售后状态字段，退款数据不可用');
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
    // 内部原因码（不进入输出 data），仅供视图选择 headline 措辞
    refund_unknown_reason: refundUnknownReason,
  };
}

// 退款率为 null 的原因：无订单样本 → no_orders；有样本但缺售后字段 → field_missing
function refundReasonOf(listStats, refundRatePct) {
  if (refundRatePct != null) return null;
  return listStats.total > 0 ? 'field_missing' : 'no_orders';
}
