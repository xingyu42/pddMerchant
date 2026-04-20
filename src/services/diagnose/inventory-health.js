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

export function scoreInventoryHealth({ goods } = {}) {
  if (!Array.isArray(goods) || goods.length === 0) {
    return {
      score: null,
      status: 'partial',
      issues: ['无商品数据'],
      hints: ['执行 pdd goods list'],
      detail: {},
    };
  }

  const issues = [];
  const hints = [];
  const total = goods.length;
  let outOfStock = 0;
  let lowStock = 0;

  for (const g of goods) {
    const qty = Number(g?.quantity ?? 0);
    if (qty === 0) outOfStock += 1;
    else if (qty < 10) lowStock += 1;
  }

  const outRate = outOfStock / total;
  const lowOrOutRate = (outOfStock + lowStock) / total;
  let score = 100;

  if (outRate > 0.05) {
    score -= 40;
    issues.push(`${outOfStock} 商品缺货（${(outRate * 100).toFixed(1)}%）`);
    hints.push('补货或下架缺货商品');
  } else if (outOfStock > 0) {
    score -= 10;
    issues.push(`${outOfStock} 商品缺货`);
    hints.push('及时补货');
  }

  if (lowOrOutRate > 0.30) {
    score -= 30;
    issues.push(`${outOfStock + lowStock} 商品低库存（${(lowOrOutRate * 100).toFixed(1)}%，>30%）`);
    hints.push('设置库存预警阈值');
  } else if (lowOrOutRate > 0.10) {
    score -= 15;
    issues.push(`${outOfStock + lowStock} 商品低库存（${(lowOrOutRate * 100).toFixed(1)}%）`);
  }

  hints.push('V0 未关联订单数据，暂无法识别滞销（30 天 0 销）');

  const finalScore = clampScore(score);
  return {
    score: finalScore,
    status: statusFromScore(finalScore),
    issues,
    hints,
    detail: {
      total,
      out_of_stock: outOfStock,
      low_stock: lowStock,
      out_of_stock_rate: Number(outRate.toFixed(4)),
      low_or_out_rate: Number(lowOrOutRate.toFixed(4)),
    },
  };
}
