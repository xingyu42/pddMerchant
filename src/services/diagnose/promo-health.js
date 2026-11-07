import { round, toFiniteNumber } from '../../infra/units.js';
import { ratioPct } from '../../infra/metrics.js';

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

  const impression = toFiniteNumber(totals.impression);
  const click = toFiniteNumber(totals.click);
  // 成交金额缺失（含 MoneyVO 单位未知）→ null，不补 0
  const gmv = toFiniteNumber(totals.gmv);
  const spend = resolveSpend(totals);

  const issues = [];
  const hints = [];

  const roi = spend != null && spend > 0 && gmv !== null ? gmv / spend : null;

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
      gmv_yuan: round(gmv, 2),
      spend_yuan: spend == null ? null : round(spend, 2),
      // 曝光为 0 时点击率无分母 → null
      ctr_pct: ratioPct(click, impression),
      roi: roi == null ? null : round(roi, 2),
    },
  };
}
