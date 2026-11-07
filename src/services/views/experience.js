import { round, toPct } from '../../infra/units.js';
import { DATA_STATUS_LABEL } from './labels.js';
import { defineReport, reportHints } from '../operating-report.js';

const EXPERIENCE_DIMENSION_LABEL = Object.freeze({
  after_sales: '售后服务', quality: '商品品质', logistics: '物流服务', activity: '店铺活跃', special: '特色服务',
});
const EXPERIENCE_UNIT_LABEL = Object.freeze({ pct: '百分比', hours: '小时', days: '天', raw: '平台原值' });
const EXPERIENCE_STANDARD_LABEL = Object.freeze({ 0: '已达标', 1: '未达标' });
export const EXPERIENCE_REPORT = defineReport({
  days: { min: 1, max: 30, default: 7, separator: '–', message: '--days 需为 {range} 的整数',
    description: '趋势窗口天数（{range}）' },
  hints: { ready_date_unavailable: '趋势就绪日期拉取失败', trend_unavailable: '趋势数据拉取失败', delayed: '平台标记数据延迟' },
});

// Field mapping is owned here; adapter projection independently limits the upstream surface.
const INDICATORS = [
  ['platform_help_rate_pct', 'after_sales', '近30天平台求助率', 'ptHelpRate1m', 'pct', true],
  ['manual_reply_3min_rate_pct', 'after_sales', '近30天3分钟人工回复率', 'aprsIn3minRplyUsrRto1m', 'pct', true],
  ['refund_in_transit_hours', 'after_sales', '近30天在途订单退款时长', 'rfSignTime1m', 'hours'],
  ['refund_after_return_hours', 'after_sales', '近30天商家签收退货后平均退款时长', 'rfProcTime1m', 'hours'],
  ['review_score_rank', 'quality', '近90天用户评价得分排名', 'dsr3m', 'raw'],
  ['positive_review_rate_pct', 'quality', '近30天积极评论率', 'posTypeRto1m', 'pct', true],
  ['serious_inferior_rate_pct', 'quality', '近30天严重劣质率', 'seriousInferiorRto1m', 'pct', true],
  ['group_to_sign_days', 'logistics', '近30天成团-签收时效', 'adjNfkAvgCfmSignTime1m', 'days'],
  ['logistics_violation_rate_pct', 'logistics', '近30天物流综合违规处理率', 'lgstMergeFine1m', 'pct', true],
  ['shop_activity_pct', 'activity', '近30天店铺活跃度', 'gmvRk', 'pct'],
];

export const EXPERIENCE_INDICATOR_FIELDS = Object.freeze([
  'key', 'dimension', 'name', 'value', 'unit', 'next_star_threshold', 'next_star_status',
]);
export const EXPERIENCE_SNAPSHOT_FIELDS = Object.freeze([
  'stat_date', 'star', 'star_change', 'next_star', 'next_star_rank_pct', 'score_rank_pct',
  'score_grade', 'star_text', 'industry',
]);
export const EXPERIENCE_TREND_ITEM_FIELDS = Object.freeze([
  'date', 'star', 'score_rank_pct', ...INDICATORS.map(([key]) => key),
]);

function standardLabel(code) {
  return code === 0 || code === 1 ? EXPERIENCE_STANDARD_LABEL[code] : null;
}

function indicatorView(info, [key, dimension, name, field, unit, ratio]) {
  const convert = ratio ? toPct : round;
  const value = convert(info[field]);
  return { key, dimension: EXPERIENCE_DIMENSION_LABEL[dimension], name, value,
    unit: EXPERIENCE_UNIT_LABEL[unit], next_star_threshold: convert(info[`${field}NextPctThreshold`]),
    next_star_status: value === null ? null : standardLabel(info[`${field}NextStarRkDesc`]) };
}

function snapshotView(info) {
  return {
    stat_date: info.timestamp ?? null, star: round(info.mallStarTomms),
    star_change: round(info.mallStarTommsChange), next_star: round(info.mallStarTommsNext),
    next_star_rank_pct: round(info.mallStarTommsNextPct), score_rank_pct: round(info.scoreRk),
    score_grade: info.scoreDsc ?? null, star_text: info.mallStarDesc ?? null, industry: info.stplName ?? null,
  };
}

function trendView(trend) {
  if (trend === null) return null;
  const items = trend.items.map((item) => ({
    date: item.pt ?? null, star: round(item.mallStarTomms), score_rank_pct: round(item.scoreRk),
    ...Object.fromEntries(INDICATORS.map(([key, , , field, , ratio]) =>
      [key, ratio ? toPct(item[field]) : round(item[field])])),
  }));
  items.sort((left, right) => String(left.date).localeCompare(String(right.date)));
  return { start_date: trend.start_date, end_date: trend.end_date, days: trend.days, items };
}

function starHeadline(snapshot) {
  let line = '店铺综合体验星级';
  if (snapshot.star !== null) line += ` ${snapshot.star} 星`;
  if (snapshot.star_change !== null) line += `（较前1天 ${snapshot.star_change}）`;
  if (snapshot.next_star !== null) line += `，下一星级 ${snapshot.next_star} 星`;
  return line === '店铺综合体验星级' ? `${line}数据缺失` : line;
}

function headlines(snapshot, indicators) {
  const lines = [starHeadline(snapshot)];
  const rank = snapshot.score_rank_pct === null ? '' : `领航员综合分行业排名 ${snapshot.score_rank_pct}%`;
  const grade = snapshot.score_grade == null ? '' : `平台评级「${snapshot.score_grade}」`;
  if (rank || grade) lines.push([rank, grade].filter(Boolean).join('，'));
  const met = indicators.filter((item) => item.next_star_status === EXPERIENCE_STANDARD_LABEL[0]).length;
  const unmet = indicators.filter((item) => item.next_star_status === EXPERIENCE_STANDARD_LABEL[1]).length;
  lines.push(`考核指标 ${indicators.length} 项，已达标 ${met} 项、未达标 ${unmet} 项`);
  return lines;
}

export function toExperienceView(info, { trend = null, mallId = null, hints = [] } = {}) {
  const snapshot = snapshotView(info);
  const indicators = INDICATORS.map((definition) => indicatorView(info, definition));
  const delayed = [info, ...(trend?.items ?? [])]
    .some((item) => item.normalFlag === false || item.delayData != null);
  const hintKeys = [...hints, ...(delayed ? ['delayed'] : [])];
  return {
    headline: headlines(snapshot, indicators), status: DATA_STATUS_LABEL[trend === null ? 'partial' : 'full'],
    snapshot, indicators,
    consumer_experience_plan: { enabled: info.isRps ?? null, required: info.isRequireRps ?? null,
      next_star_status: standardLabel(info.isRpsNextStarRkDesc) },
    trend: trendView(trend), hints: reportHints(EXPERIENCE_REPORT, [...new Set(hintKeys)]), mall_id: mallId,
  };
}
