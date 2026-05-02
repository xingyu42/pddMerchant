import { getPromoReport } from './promo.js';

function classifyRow(spend, gmv, breakEvenRoi) {
  if (spend === 0 || spend == null) return { roi: null, status: 'no_spend' };
  if (gmv === 0) return { roi: 0, status: 'critical_waste' };
  const roi = Number((gmv / spend).toFixed(2));
  if (roi >= 2.0) return { roi, status: 'scale' };
  if (roi >= breakEvenRoi) return { roi, status: 'optimize' };
  return { roi, status: 'waste' };
}

function isInactive(entity) {
  return Boolean(entity.isDeleted || entity.planDeleted || entity.adDeleted);
}

function groupKey(entity, by) {
  if (by === 'sku') {
    const gid = entity.goodsId ?? entity.goods_id;
    return gid != null && gid !== '' ? String(gid) : (entity.goodsName ?? entity.goods_name ?? 'unknown');
  }
  if (by === 'channel') {
    return String(entity.scenesType ?? entity.promotionType ?? 'unknown');
  }
  const pid = entity.planId ?? entity.plan_id ?? 'unknown';
  const aid = entity.adId ?? entity.ad_id ?? '';
  return `${pid}:${aid}`;
}

function groupLabel(entity, by) {
  if (by === 'sku') return entity.goodsName ?? entity.goods_name ?? 'unknown';
  if (by === 'channel') return entity.promotionType ?? String(entity.scenesType ?? 'unknown');
  return entity.adName ?? entity.ad_name ?? `plan:${entity.planId ?? '?'}`;
}

export function analyzePromoRoi(input, options = {}) {
  const { entities = [], totals = {} } = input ?? {};
  const {
    by = 'plan',
    breakEvenRoi = 1.0,
    includeInactive = false,
  } = options;

  const warnings = [];
  const grouped = new Map();
  let excludedCount = 0;
  let excludedSpend = 0;

  for (const entity of entities) {
    if (!includeInactive && isInactive(entity)) {
      excludedCount += 1;
      excludedSpend += Number(entity.spend ?? entity.cost ?? 0);
      continue;
    }

    const key = groupKey(entity, by);
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        label: groupLabel(entity, by),
        plan_id: entity.planId ?? entity.plan_id ?? null,
        ad_id: entity.adId ?? entity.ad_id ?? null,
        ad_name: entity.adName ?? entity.ad_name ?? null,
        goods_id: entity.goodsId ?? entity.goods_id ?? null,
        goods_name: entity.goodsName ?? entity.goods_name ?? null,
        scenes_type: entity.scenesType ?? null,
        promotion_type: entity.promotionType ?? null,
        impression: 0,
        click: 0,
        gmv: 0,
        spend: 0,
        is_inactive: isInactive(entity),
      });
    }
    const row = grouped.get(key);
    row.impression += Number(entity.impression ?? 0);
    row.click += Number(entity.click ?? 0);
    row.gmv += Number(entity.gmv ?? 0);
    row.spend += Number(entity.spend ?? entity.cost ?? 0);
  }

  const rows = [];
  let wasteCount = 0;
  let wasteSpend = 0;
  let scaleCount = 0;
  let optimizeCount = 0;
  let totalSpend = 0;
  let totalGmv = 0;

  for (const row of grouped.values()) {
    const { roi, status } = classifyRow(row.spend, row.gmv, breakEvenRoi);
    const ctr = row.impression > 0 ? Number((row.click / row.impression).toFixed(4)) : 0;
    rows.push({ ...row, ctr, roi, status });

    totalSpend += row.spend;
    totalGmv += row.gmv;
    if (status === 'waste' || status === 'critical_waste') {
      wasteCount += 1;
      wasteSpend += row.spend;
    }
    if (status === 'scale') scaleCount += 1;
    if (status === 'optimize') optimizeCount += 1;
  }

  rows.sort((a, b) => (b.roi ?? -1) - (a.roi ?? -1));

  const overallRoi = totalSpend > 0 ? Number((totalGmv / totalSpend).toFixed(2)) : null;

  return {
    by,
    break_even_roi: breakEvenRoi,
    rows,
    summary: {
      total_rows: rows.length,
      excluded_inactive: excludedCount,
      excluded_inactive_spend: excludedSpend,
      waste_count: wasteCount,
      waste_spend: wasteSpend,
      scale_count: scaleCount,
      optimize_count: optimizeCount,
      total_spend: totalSpend,
      total_gmv: totalGmv,
      overall_roi: overallRoi,
    },
    totals,
    warnings,
  };
}

export async function getPromoRoi(page, params = {}, ctx = {}) {
  const report = await getPromoReport(page, {
    type: 'entity',
    page: params.page,
    size: params.size,
    since: params.since,
    until: params.until,
  }, ctx);

  return analyzePromoRoi(
    { entities: report?.entities ?? [], totals: report?.totals ?? {} },
    {
      by: params.by ?? 'plan',
      breakEvenRoi: params.breakEven ?? 1.0,
      includeInactive: params.includeInactive ?? false,
    },
  );
}
