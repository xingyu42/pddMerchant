import { toPct } from '../../infra/units.js';

export function summarizeAfterSales({ orderStats, windowDays } = {}) {
  if (!orderStats || !Number.isFinite(orderStats.total)) {
    return {
      status: 'partial',
      issues: [],
      hints: ['需要订单售后状态数据才能统计售后情况'],
      detail: {},
    };
  }

  const total = orderStats.total;
  // 售后字段缺失时保留未知计数；空样本的占比没有分母。
  const refundCount = orderStats.refund_count == null ? null : Number(orderStats.refund_count);
  const afterSalesCount = orderStats.after_sales_count == null ? null : Number(orderStats.after_sales_count);
  const statusDist = orderStats.status_distribution ?? {};

  const issues = [];
  const hints = [];
  if (total > 0 && (refundCount == null || afterSalesCount == null)) {
    hints.push('订单样本售后统计字段缺失，部分售后数据不可用');
  }

  return {
    status: 'full',
    issues,
    hints,
    detail: {
      total_orders: total,
      refund_count: refundCount,
      refund_rate_pct: total > 0 && refundCount != null ? toPct(refundCount / total) : null,
      after_sales_count: afterSalesCount,
      after_sales_rate_pct: total > 0 && afterSalesCount != null ? toPct(afterSalesCount / total) : null,
      status_distribution: statusDist,
      window_days: windowDays ?? null,
    },
  };
}
