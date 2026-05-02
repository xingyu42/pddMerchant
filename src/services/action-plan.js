const WEIGHTS = Object.freeze({
  orders: 0.35,
  inventory: 0.20,
  promo: 0.30,
  funnel: 0.15,
});

function severityScore(status) {
  if (status === 'red') return 100;
  if (status === 'yellow') return 50;
  return 0;
}

function priorityLabel(score) {
  if (score >= 120) return 'urgent';
  if (score >= 60) return 'important';
  return 'suggestion';
}

function actionKey(a) {
  return `${a.target_type}:${a.target_id ?? ''}:${a.action}`;
}

function addPromoActions(actions, promoRoi) {
  if (!promoRoi?.rows) return;
  for (const row of promoRoi.rows) {
    if (row.status === 'critical_waste') {
      actions.push({
        dimension: 'promo',
        action: 'pause_plan',
        target_type: 'plan',
        target_id: row.plan_id != null ? String(row.plan_id) : null,
        target_name: row.ad_name ?? row.goods_name ?? 'unknown',
        reason: `花费 ${row.spend} 元零 GMV，立即暂停`,
        confidence: 'high',
        _severity: 100,
      });
    } else if (row.status === 'waste') {
      actions.push({
        dimension: 'promo',
        action: 'reduce_budget',
        target_type: 'plan',
        target_id: row.plan_id != null ? String(row.plan_id) : null,
        target_name: row.ad_name ?? row.goods_name ?? 'unknown',
        reason: `ROI=${row.roi} 低于保本线，花费 ${row.spend} 元`,
        confidence: 'high',
        _severity: 100,
      });
    } else if (row.status === 'scale') {
      actions.push({
        dimension: 'promo',
        action: 'increase_budget',
        target_type: 'plan',
        target_id: row.plan_id != null ? String(row.plan_id) : null,
        target_name: row.ad_name ?? row.goods_name ?? 'unknown',
        reason: `ROI=${row.roi} 表现优秀 (无成本数据，利润不确定)`,
        confidence: 'low',
        _severity: 0,
      });
    }
  }
}

function addSegmentationActions(actions, segmentation) {
  if (!segmentation?.items) return;
  for (const item of segmentation.items) {
    if (item.tier === 'D') {
      actions.push({
        dimension: 'segmentation',
        action: 'clearance',
        target_type: 'goods',
        target_id: item.goods_id,
        target_name: item.goods_name,
        reason: `D 类商品 (composite=${item.composite_score})，建议清仓`,
        confidence: 'medium',
        _severity: 50,
      });
    } else if (item.action === 'restock') {
      actions.push({
        dimension: 'inventory',
        action: 'restock',
        target_type: 'goods',
        target_id: item.goods_id,
        target_name: item.goods_name,
        reason: `${item.tier} 类主推/潜力款断货，优先补货`,
        confidence: 'high',
        _severity: 100,
      });
    } else if (item.tier === 'B') {
      actions.push({
        dimension: 'segmentation',
        action: 'test_optimize',
        target_type: 'goods',
        target_id: item.goods_id,
        target_name: item.goods_name,
        reason: `B 类潜力款 (composite=${item.composite_score})，测图测价`,
        confidence: 'medium',
        _severity: 25,
      });
    }
  }
}

function addDiagnosisActions(actions, diagnosis) {
  if (!diagnosis?.dimensions) return;
  const ordDim = diagnosis.dimensions.orders;
  if (ordDim?.detail) {
    if (ordDim.detail.delay_count > 0) {
      actions.push({
        dimension: 'orders',
        action: 'process_delayed_orders',
        target_type: 'store',
        target_id: null,
        target_name: '店铺',
        reason: `${ordDim.detail.delay_count} 单延迟发货`,
        confidence: 'high',
        _severity: severityScore(ordDim.status),
      });
    }
    if (ordDim.detail.shipping_p95_hours > 48) {
      actions.push({
        dimension: 'orders',
        action: 'improve_shipping',
        target_type: 'store',
        target_id: null,
        target_name: '店铺',
        reason: `发货 P95=${ordDim.detail.shipping_p95_hours}h (>48h)`,
        confidence: 'high',
        _severity: severityScore(ordDim.status),
      });
    }
  }
  const invDim = diagnosis.dimensions.inventory;
  if (invDim?.detail?.out_of_stock_rate > 0.05) {
    actions.push({
      dimension: 'inventory',
      action: 'restock_or_delist',
      target_type: 'store',
      target_id: null,
      target_name: '店铺',
      reason: `${invDim.detail.out_of_stock} 件缺货 (${(invDim.detail.out_of_stock_rate * 100).toFixed(1)}%)`,
      confidence: 'high',
      _severity: severityScore(invDim.status),
    });
  }
}

export function generateActionPlan(input, options = {}) {
  const { diagnosis, promoRoi, segmentation, compare } = input ?? {};
  const { limit = 10 } = options;

  const rawActions = [];

  addPromoActions(rawActions, promoRoi);
  addSegmentationActions(rawActions, segmentation);
  addDiagnosisActions(rawActions, diagnosis);

  for (const a of rawActions) {
    const dimWeight = WEIGHTS[a.dimension] ?? 0.10;
    const weightBonus = dimWeight * 100;
    let trendBonus = 0;
    if (compare?.dimensions?.[a.dimension]) {
      const dp = compare.dimensions[a.dimension].delta_pct;
      if (typeof dp === 'number' && dp < 0) trendBonus = Math.abs(dp) * 0.5;
    }
    a.priority_score = Math.round(a._severity + weightBonus + trendBonus);
    a.priority = priorityLabel(a.priority_score);
  }

  const seen = new Set();
  const deduped = [];
  for (const a of rawActions) {
    const key = actionKey(a);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(a);
  }

  deduped.sort((a, b) => b.priority_score - a.priority_score);
  const limited = deduped.slice(0, limit);

  for (const a of limited) delete a._severity;

  let urgent = 0;
  let important = 0;
  let suggestion = 0;
  for (const a of limited) {
    if (a.priority === 'urgent') urgent += 1;
    else if (a.priority === 'important') important += 1;
    else suggestion += 1;
  }

  return {
    summary: { urgent, important, suggestion, total: limited.length },
    actions: limited,
    data_completeness: {
      diagnosis: diagnosis != null,
      promo_roi: promoRoi != null,
      segmentation: segmentation != null,
      trend_compare: compare != null,
    },
    generated_at: new Date().toISOString(),
  };
}
