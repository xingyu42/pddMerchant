function clampScore(n) {
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function statusFromScore(score) {
  if (score == null) return 'partial';
  if (score >= 80) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

export function scoreOrdersHealth({ stats, listStats } = {}) {
  const issues = [];
  const hints = [];

  if (!stats && !listStats) {
    return {
      score: null,
      status: 'partial',
      issues: ['orders 数据缺失'],
      hints: ['执行 pdd orders stats 采集数据'],
      detail: {},
    };
  }

  let score = 100;
  const detail = {};

  const p95Seconds = listStats?.shipping_seconds?.p95;
  if (typeof p95Seconds === 'number') {
    const p95Hours = p95Seconds / 3600;
    detail.shipping_p95_hours = Number(p95Hours.toFixed(2));
    if (p95Hours > 48) {
      score -= 30;
      issues.push(`发货 P95 ${p95Hours.toFixed(1)}h（>48h）`);
      hints.push('优先处理长尾发货订单');
    } else if (p95Hours > 24) {
      score -= 15;
      issues.push(`发货 P95 ${p95Hours.toFixed(1)}h（24-48h）`);
      hints.push('密切监控发货时效');
    }
  } else {
    detail.shipping_p95_hours = null;
    hints.push('已发货样本不足，无法计算 P95');
  }

  const refundRate = listStats?.refund_rate;
  if (typeof refundRate === 'number') {
    detail.refund_rate = Number(refundRate.toFixed(4));
    if (refundRate > 0.10) {
      score -= 30;
      issues.push(`退款率 ${(refundRate * 100).toFixed(1)}%（>10%）`);
      hints.push('审视商品质量与售后流程');
    } else if (refundRate > 0.05) {
      score -= 15;
      issues.push(`退款率 ${(refundRate * 100).toFixed(1)}%（5-10%）`);
    }
  }

  if (stats) {
    const unship = Number(stats.unship ?? 0);
    const delay = Number(stats.delay ?? 0);
    detail.unship = unship;
    detail.delay = delay;
    if (delay > 0) {
      score -= 20;
      issues.push(`${delay} 单超时未发货`);
      hints.push('立即处理超时订单以免赔付');
    }
    if (unship > 50) {
      score -= 10;
      issues.push(`${unship} 单待发货堆积`);
    }
  }

  const finalScore = clampScore(score);
  return {
    score: finalScore,
    status: statusFromScore(finalScore),
    issues,
    hints,
    detail,
  };
}
