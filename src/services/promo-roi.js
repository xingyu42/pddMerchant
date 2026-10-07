import { getPromoReport } from './promo.js';
import { toPromoRoiView } from './views/promo.js';
import { mallIdOf } from './views/_shared.js';

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

// 金额累加：任一项缺失（如 MoneyVO 单位未知 → null）则合计未知，保持 null 而非按 0 计入
function addMoney(sum, value) {
  if (sum === null || value == null) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? sum + amount : null;
}

function entitySpend(entity) {
  return entity.spend ?? entity.cost ?? null;
}

export function analyzePromoRoi(input, options = {}) {
  const { entities = [], totals = {} } = input;
  const {
    by = 'plan',
    includeInactive = false,
  } = options;

  const warnings = [];
  const grouped = new Map();
  let excludedCount = 0;
  let excludedSpend = 0;

  for (const entity of entities) {
    if (!includeInactive && isInactive(entity)) {
      excludedCount += 1;
      excludedSpend = addMoney(excludedSpend, entitySpend(entity));
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
    row.gmv = addMoney(row.gmv, entity.gmv);
    row.spend = addMoney(row.spend, entitySpend(entity));
  }

  const rows = [];
  let totalSpend = 0;
  let totalGmv = 0;

  for (const row of grouped.values()) {
    const roi = row.spend > 0 && row.gmv !== null ? Number((row.gmv / row.spend).toFixed(2)) : null;
    const ctr = row.impression > 0 ? Number((row.click / row.impression).toFixed(4)) : 0;
    rows.push({ ...row, ctr, roi });

    totalSpend = addMoney(totalSpend, row.spend);
    totalGmv = addMoney(totalGmv, row.gmv);
  }

  rows.sort((a, b) => (b.roi ?? -1) - (a.roi ?? -1));

  const overallRoi = totalSpend > 0 && totalGmv !== null ? Number((totalGmv / totalSpend).toFixed(2)) : null;

  return {
    by,
    rows,
    summary: {
      total_rows: rows.length,
      excluded_inactive: excludedCount,
      excluded_inactive_spend: excludedSpend,
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

  const analysis = analyzePromoRoi(
    { entities: report?.entities ?? [], totals: report?.totals ?? {} },
    {
      by: params.by ?? 'plan',
      includeInactive: params.includeInactive ?? false,
    },
  );
  return { ...analysis, warnings: [...(report?.unitWarnings ?? []), ...analysis.warnings] };
}

// promo.roi 命令级结果：{ data: v2 视图, warnings }
export async function getPromoRoiView(page, params = {}, ctx = {}) {
  const { warnings, ...analysis } = await getPromoRoi(page, params, ctx);
  return { data: toPromoRoiView(analysis, { mallId: mallIdOf(ctx) }), warnings };
}
