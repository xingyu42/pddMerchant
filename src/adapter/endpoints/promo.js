import { responseShapeError } from '../../infra/errors.js';

const PROMO_NAV = {
  url: 'https://yingxiao.pinduoduo.com/goods/report/promotion/overView',
  readyEl: '[class*="report"], [class*="Report"]',
};

const PROMO_EXTERNAL_FIELDS = [
  'planId', 'adId', 'adName', 'thumbUrl',
  'goodsName', 'goodsId', 'minOnSaleGroupPrice',
  'isDeleted', 'planDeleted', 'adDeleted',
  'bid', 'targetRoi', 'planStrategy',
  'scenesType', 'scenesMode',
  'mallFavBid', 'goodsFavBid', 'inquiryBid',
  'enableExcludeRefund', 'groupName',
];

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function formatDateTime(d) {
  return d.toISOString().slice(0, 10) + ' 00:00:00';
}

// MoneyVO.unit → 换算为元的除数（research/upstream-schema-2026-10.md §5）
const MONEY_UNIT_DIVISOR = { YUAN: 1, FEN: 100 };

function finiteOrNull(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// 新版 poseidon 报表接口金额字段为 MoneyVO {unit, value, unitCode}，拍平为「元」裸数字。
// unit=YUAN 原值、FEN ÷100；其他非空未知单位 → { value: null, unknownUnit }；无 unit 的裸数字 / 字符串按元处理。
// 缺失或无效值 → null（不补 0）。
export function parseMoney(v) {
  if (v == null || typeof v !== 'object') return { value: finiteOrNull(v), unknownUnit: null };
  if (!('value' in v)) return { value: null, unknownUnit: null };
  const amount = finiteOrNull(v.value);
  const unit = typeof v.unit === 'string' ? v.unit.trim().toUpperCase() : '';
  if (unit === '') return { value: amount, unknownUnit: null };
  if (!Object.hasOwn(MONEY_UNIT_DIVISOR, unit)) return { value: null, unknownUnit: v.unit };
  return { value: amount === null ? null : amount / MONEY_UNIT_DIVISOR[unit], unknownUnit: null };
}

export function moneyToNumber(v) {
  return parseMoney(v).value;
}

// 单次 normalize 内收集未知金额单位，供 service 汇入 meta.warnings
function createMoneyReader() {
  const unknownUnits = new Set();
  const read = (v) => {
    const { value, unknownUnit } = parseMoney(v);
    if (unknownUnit != null) unknownUnits.add(String(unknownUnit));
    return value;
  };
  const warnings = () => [...unknownUnits].map((unit) => `推广金额单位未知（${unit}），相关金额输出为 null`);
  return { read, warnings };
}

// entityReportList 元素的金额/计数字段可能直接挂在元素上，也可能嵌套在 reportInfo 里
// （OQ1：当前店铺无投放数据无法实测，两种结构都兼容）。?? 链优先取顶层，回退到 reportInfo。
export function flattenEntity(e, money = moneyToNumber) {
  if (e == null) return null;
  const r = e.reportInfo ?? {};
  return {
    planId: e.planId ?? r.planId,
    adId: e.adId ?? r.adId,
    adName: e.adName ?? r.adName ?? e.goodsName ?? r.goodsName,
    goodsId: e.goodsId ?? r.goodsId,
    goodsName: e.goodsName ?? r.goodsName,
    scenesType: e.scenesType ?? r.scenesType,
    scenesMode: e.scenesMode ?? r.scenesMode,
    promotionType: e.promotionType ?? r.promotionType,
    isDeleted: e.isDeleted ?? r.isDeleted,
    planDeleted: e.planDeleted ?? r.planDeleted,
    adDeleted: e.adDeleted ?? r.adDeleted,
    thumbUrl: e.thumbUrl ?? r.thumbUrl,
    groupName: e.groupName ?? r.groupName,
    impression: Number(e.impression ?? r.impression ?? 0),
    click: Number(e.click ?? r.click ?? 0),
    gmv: money(e.gmv ?? r.gmv),
    spend: money(e.spend ?? r.spend ?? e.cost ?? r.cost),
    netGmv: money(e.netGmv ?? r.netGmv),
  };
}

// 拍平 totalSumReport / sumReport 中的 MoneyVO 字段为元。
// 只输出下游实际消费的字段集合（避免 60+ 个原始字段经 ...totals 展开泄露到 envelope，
// 违反 spec「raw 不泄露到 command」）。新增下游消费者时按需补字段。
// spend 与 cost 为同一口径（spend ?? cost），不再重复输出 cost；上游 ctr 口径未知，由下游按点击/曝光计算。
function flattenTotals(totals, money = moneyToNumber) {
  if (totals == null) return {};
  return {
    impression: Number(totals.impression ?? 0),
    click: Number(totals.click ?? 0),
    gmv: money(totals.gmv),
    spend: money(totals.spend ?? totals.cost),
    netGmv: money(totals.netGmv),
    costPerOrder: money(totals.costPerOrder),
    goodsFavSpend: money(totals.goodsFavSpend),
    mallFavSpend: money(totals.mallFavSpend),
    inquirySpend: money(totals.inquirySpend),
  };
}

function hasSuccessfulResult(raw) {
  if (raw?.success === false) return false;
  return raw?.result !== undefined;
}

function isMetric(value) {
  const candidate = value && typeof value === 'object' ? value.value : value;
  return (typeof candidate === 'number' || (typeof candidate === 'string' && candidate.trim() !== ''))
    && Number.isFinite(Number(candidate));
}

function requireMetrics(row, endpoint, field) {
  const nested = row?.reportInfo;
  const values = [row?.impression ?? nested?.impression, row?.click ?? nested?.click,
    row?.gmv ?? nested?.gmv, row?.spend ?? nested?.spend ?? row?.cost ?? nested?.cost];
  if (!row || typeof row !== 'object' || Array.isArray(row) || !values.every(isMetric)) {
    throw responseShapeError(endpoint, `${field}.impression/click/gmv/spend`);
  }
}

function readReport(raw, endpoint, totalsField, listField) {
  const result = raw?.result;
  if (!result || !Array.isArray(result[listField])) {
    throw responseShapeError(endpoint, `result.${listField}`);
  }
  requireMetrics(result[totalsField], endpoint, `result.${totalsField}`);
  return result;
}

export const PROMO_ENTITY_REPORT = {
  name: 'promo.entityReport',
  urlPattern: /mms-gateway\/poseidon\/api\/report\/queryEntityReport/,
  apiUrl: '/mms-gateway/poseidon/api/report/queryEntityReport',
  nav: PROMO_NAV,
  trigger: async () => {
    // 页面自动加载
  },
  buildPayload: (params = {}, ctx = {}) => {
    const now = new Date();
    const since = params.since ?? new Date(now.getTime() - 7 * 86400000);
    const until = params.until ?? now;
    return {
      clientType: 1,
      entityId: ctx.mallId,
      entityDimensionType: 0,
      queryDimensionType: 2,
      reportPromotionType: params.promotionType ?? 9,
      blockTypes: [6],
      startDate: formatDate(since),
      endDate: formatDate(until),
      externalFields: PROMO_EXTERNAL_FIELDS,
      queryRange: { pageNumber: params.page ?? 1, pageSize: params.size ?? 10 },
      orderBy: 9999,
      orderType: 9999,
      queryHasStableCostSmartAd: true,
      returnTotalSumReport: true,
    };
  },
  normalize: (raw) => {
    const result = readReport(raw, 'promo.entityReport', 'totalSumReport', 'entityReportList');
    for (const entity of result.entityReportList) requireMetrics(entity, 'promo.entityReport', 'entityReportList[]');
    const money = createMoneyReader();
    const totals = flattenTotals(result.totalSumReport, money.read);
    const entities = result.entityReportList
      .map((entity) => flattenEntity(entity, money.read))
      .filter(Boolean);
    return { entities, totals, unitWarnings: money.warnings(), raw };
  },
  isSuccess: hasSuccessfulResult,
};

export const PROMO_HOURLY_REPORT = {
  name: 'promo.hourlyReport',
  urlPattern: /mms-gateway\/poseidon\/api\/report\/queryHourlyRangeReport/,
  apiUrl: '/mms-gateway/poseidon/api/report/queryHourlyRangeReport',
  nav: PROMO_NAV,
  trigger: async () => {
    // 页面自动加载
  },
  buildPayload: (params = {}, ctx = {}) => {
    const now = new Date();
    const since = params.since ?? new Date(now.getTime() - 7 * 86400000);
    return {
      clientType: 1,
      entityId: ctx.mallId,
      queryDimensionType: 0,
      endDayHour: 23,
      endDate: formatDateTime(now),
      startDate: formatDateTime(since),
      reportPromotionType: params.promotionType ?? 9,
      blockTypes: [5],
      returnAnchorPoints: true,
    };
  },
  normalize: (raw) => {
    const result = readReport(raw, 'promo.hourlyReport', 'sumReport', 'hourlyPoints');
    const money = createMoneyReader();
    return {
      totals: flattenTotals(result.sumReport, money.read), hourlyPoints: result.hourlyPoints,
      anchorPoints: result.anchorPoints ?? {}, unitWarnings: money.warnings(), raw,
    };
  },
  isSuccess: hasSuccessfulResult,
};
