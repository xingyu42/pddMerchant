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

function resolveSpend(totals) {
  if (totals == null) return null;
  if (typeof totals.spend === 'number') return totals.spend;
  if (typeof totals.cost === 'number') return totals.cost;
  const favSum = (totals.goodsFavSpend ?? 0) + (totals.mallFavSpend ?? 0) + (totals.inquirySpend ?? 0);
  if (favSum > 0) return favSum;
  return null;
}

export function scorePromoHealth({ totals, entities, roiAnalysis } = {}) {
  if (!totals) {
    return {
      score: null,
      status: 'partial',
      issues: ['推广数据缺失'],
      hints: ['执行 pdd promo report 或确认推广活动'],
      detail: {},
    };
  }

  const impression = Number(totals.impression ?? 0);
  const click = Number(totals.click ?? 0);
  const gmv = Number(totals.gmv ?? 0);
  const spend = resolveSpend(totals);

  if (impression === 0 && click === 0 && gmv === 0 && (spend == null || spend === 0)) {
    return {
      score: null,
      status: 'partial',
      issues: ['本期无推广活动'],
      hints: ['如需推广拉新，考虑启动场景推广'],
      detail: { impression, click, gmv, spend: spend ?? 0 },
    };
  }

  const issues = [];
  const hints = [];
  let score = 100;

  const ctr = impression > 0 ? click / impression : 0;
  const roi = spend != null && spend > 0 ? gmv / spend : null;

  if (roi != null) {
    if (roi < 1) {
      score -= 40;
      issues.push(`ROI=${roi.toFixed(2)}（<1，亏损）`);
      hints.push('暂停低效推广计划，重做出价/定向');
    } else if (roi < 2) {
      score -= 20;
      issues.push(`ROI=${roi.toFixed(2)}（1-2，待优化）`);
      hints.push('优化出价策略与素材');
    }
  } else {
    hints.push('无花费数据，ROI 不可评估');
  }

  if (impression > 1000 && ctr < 0.01) {
    score -= 20;
    issues.push(`CTR=${(ctr * 100).toFixed(2)}%（偏低）`);
    hints.push('优化商品主图与标题');
  }

  if (impression > 10000 && click === 0) {
    score -= 20;
    issues.push('高曝光零点击，可能素材或定向异常');
  }

  let wastePlanCount = null;
  let wasteSpend = null;
  let perPlanRoiAvailable = false;

  if (roiAnalysis && roiAnalysis.summary) {
    wastePlanCount = roiAnalysis.summary.waste_count ?? 0;
    wasteSpend = roiAnalysis.summary.waste_spend ?? 0;
    perPlanRoiAvailable = true;
    if (wastePlanCount > 0) {
      issues.push(`${wastePlanCount} 个计划 ROI 低于保本线，烧钱 ${wasteSpend}`);
      hints.push('执行 pdd promo roi 查看具体浪费计划');
    }
  } else if (Array.isArray(entities) && entities.length > 0) {
    let wc = 0;
    let ws = 0;
    for (const e of entities) {
      const s = Number(e.spend ?? e.cost ?? 0);
      const g = Number(e.gmv ?? 0);
      if (s > 0 && g / s < 1) { wc += 1; ws += s; }
    }
    wastePlanCount = wc;
    wasteSpend = ws;
    perPlanRoiAvailable = true;
    if (wc > 0) {
      issues.push(`${wc} 个计划 ROI 低于保本线，烧钱 ${ws}`);
      hints.push('执行 pdd promo roi 查看具体浪费计划');
    }
  }

  const finalScore = clampScore(score);
  return {
    score: finalScore,
    status: statusFromScore(finalScore),
    issues,
    hints,
    detail: {
      impression,
      click,
      gmv,
      spend: spend ?? 0,
      ctr: Number(ctr.toFixed(4)),
      roi: roi == null ? null : Number(roi.toFixed(2)),
      waste_plan_count: wastePlanCount,
      waste_spend: wasteSpend,
      per_plan_roi_available: perPlanRoiAvailable,
    },
  };
}
