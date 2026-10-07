// 推广 ROI 视图（输出契约 v2）：analyzePromoRoi 的内部结果 → 元 / 百分数 / 中文标签。
// ROI 保持倍数（gmv / spend）；点击率由点击 / 曝光计算，曝光为 0 时为 null。
import { labelOf, round, toPct } from '../../infra/units.js';
import { text, yuanText } from './_shared.js';
import { PROMO_GROUP_BY_LABEL, SCENES_TYPE_LABEL } from './labels.js';

export const PROMO_ROI_ITEM_FIELDS = Object.freeze([
  'label', 'plan_id', 'ad_id', 'ad_name', 'goods_id', 'goods_name', 'scenes_type', 'promotion_type',
  'impression', 'click', 'ctr_pct', 'spend_yuan', 'gmv_yuan', 'roi', 'is_inactive',
]);

export const PROMO_TOTALS_FIELDS = Object.freeze([
  'impression', 'click', 'ctr_pct', 'spend_yuan', 'gmv_yuan', 'net_gmv_yuan', 'cost_per_order_yuan',
  'goods_fav_spend_yuan', 'mall_fav_spend_yuan', 'inquiry_spend_yuan',
]);

export function ctrPct(click, impression) {
  return impression > 0 ? toPct(click / impression) : null;
}

function rowLabel(row, by) {
  if (by === 'channel') {
    return row.scenes_type != null ? labelOf(SCENES_TYPE_LABEL, row.scenes_type) : labelOf({}, row.promotion_type);
  }
  return text(row.label);
}

export function toPromoRoiItemView(row, by) {
  return {
    label: rowLabel(row, by),
    plan_id: text(row.plan_id),
    ad_id: text(row.ad_id),
    ad_name: text(row.ad_name),
    goods_id: text(row.goods_id),
    goods_name: text(row.goods_name),
    scenes_type: labelOf(SCENES_TYPE_LABEL, row.scenes_type),
    // promotionType 无值域证据：非空码一律输出 '未知(<code>)'
    promotion_type: labelOf({}, row.promotion_type),
    impression: row.impression,
    click: row.click,
    ctr_pct: ctrPct(row.click, row.impression),
    spend_yuan: round(row.spend, 2),
    gmv_yuan: round(row.gmv, 2),
    roi: row.roi,
    is_inactive: row.is_inactive,
  };
}

// 上游报表合计（endpoint flattenTotals 结果，金额已为元）；缺失为 null
export function toPromoTotalsView(totals) {
  if (!totals || Object.keys(totals).length === 0) return null;
  return {
    impression: totals.impression ?? null,
    click: totals.click ?? null,
    ctr_pct: ctrPct(totals.click, totals.impression),
    spend_yuan: round(totals.spend, 2),
    gmv_yuan: round(totals.gmv, 2),
    net_gmv_yuan: round(totals.netGmv, 2),
    cost_per_order_yuan: round(totals.costPerOrder, 2),
    goods_fav_spend_yuan: round(totals.goodsFavSpend, 2),
    mall_fav_spend_yuan: round(totals.mallFavSpend, 2),
    inquiry_spend_yuan: round(totals.inquirySpend, 2),
  };
}

function toSummaryView(summary) {
  return {
    spend_yuan: round(summary.total_spend, 2),
    gmv_yuan: round(summary.total_gmv, 2),
    roi: summary.overall_roi,
    excluded_inactive_count: summary.excluded_inactive,
    excluded_inactive_spend_yuan: round(summary.excluded_inactive_spend, 2),
  };
}

function promoHeadline(byLabel, items, summary) {
  if (items.length === 0 && summary.excluded_inactive_count === 0) return ['本页无推广数据'];
  const reason = summary.spend_yuan === 0 ? '（花费为 0）' : '（金额缺失）';
  const roi = summary.roi == null ? `ROI 无法计算${reason}` : `ROI ${summary.roi}`;
  const headline = [`本页按${byLabel}统计 ${items.length} 项：花费 ${yuanText(summary.spend_yuan, '未记录')}，成交 ${yuanText(summary.gmv_yuan, '未记录')}，${roi}`];
  if (summary.excluded_inactive_count > 0) {
    headline.push(`已排除已删除的推广 ${summary.excluded_inactive_count} 项（花费 ${yuanText(summary.excluded_inactive_spend_yuan, '未记录')}）`);
  }
  return headline;
}

// analysis：analyzePromoRoi 结果（不含 warnings）
export function toPromoRoiView(analysis, { mallId = null } = {}) {
  const items = analysis.rows.map((row) => toPromoRoiItemView(row, analysis.by));
  const summary = toSummaryView(analysis.summary);
  const byLabel = labelOf(PROMO_GROUP_BY_LABEL, analysis.by);
  return {
    headline: promoHeadline(byLabel, items, summary),
    by: byLabel,
    items,
    total: items.length,
    summary,
    totals: toPromoTotalsView(analysis.totals),
    mall_id: mallId,
  };
}
