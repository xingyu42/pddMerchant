function resolveSpend(totals) {
  if (totals == null) return null;
  if (typeof totals.spend === 'number') return totals.spend;
  if (typeof totals.cost === 'number') return totals.cost;
  const favSum = (totals.goodsFavSpend ?? 0) + (totals.mallFavSpend ?? 0) + (totals.inquirySpend ?? 0);
  if (favSum > 0) return favSum;
  return null;
}

export function summarizePromo({ totals } = {}) {
  if (!totals) {
    return {
      status: 'partial',
      issues: ['推广数据缺失'],
      hints: ['执行 pdd promo roi 查询推广数据'],
      detail: {},
    };
  }

  const impression = Number(totals.impression ?? 0);
  const click = Number(totals.click ?? 0);
  const gmv = Number(totals.gmv ?? 0);
  const spend = resolveSpend(totals);

  const issues = [];
  const hints = [];

  const ctr = impression > 0 ? click / impression : 0;
  const roi = spend != null && spend > 0 ? gmv / spend : null;

  if (spend == null) {
    hints.push('无花费数据，ROI 不可评估');
  }
  return {
    status: spend == null ? 'partial' : 'full',
    issues,
    hints,
    detail: {
      impression,
      click,
      gmv,
      spend,
      ctr: Number(ctr.toFixed(4)),
      roi: roi == null ? null : Number(roi.toFixed(2)),
    },
  };
}
