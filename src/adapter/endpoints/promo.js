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

// 新版 poseidon 报表接口金额字段为 MoneyVO {unit, value, unitCode}，拍平回裸数字供下游消费。
// 兼容裸数字、null、字符串、非对象输入；无效值归 0。
export function moneyToNumber(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'object' && 'value' in v) {
    const n = Number(v.value);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// entityReportList 元素的金额/计数字段可能直接挂在元素上，也可能嵌套在 reportInfo 里
// （OQ1：当前店铺无投放数据无法实测，两种结构都兼容）。?? 链优先取顶层，回退到 reportInfo。
export function flattenEntity(e) {
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
    gmv: moneyToNumber(e.gmv ?? r.gmv),
    spend: moneyToNumber(e.spend ?? r.spend ?? e.cost ?? r.cost),
    ctr: moneyToNumber(e.ctr ?? r.ctr),
    netGmv: moneyToNumber(e.netGmv ?? r.netGmv),
  };
}

// 拍平 totalSumReport / sumReport 中的 MoneyVO 字段为裸数字。
// 只输出下游实际消费的字段集合（避免 60+ 个原始字段经 ...totals 展开泄露到 envelope，
// 违反 spec「raw 不泄露到 command」）。新增下游消费者时按需补字段。
function flattenTotals(totals) {
  if (totals == null) return {};
  return {
    impression: Number(totals.impression ?? 0),
    click: Number(totals.click ?? 0),
    gmv: moneyToNumber(totals.gmv),
    spend: moneyToNumber(totals.spend ?? totals.cost),
    cost: moneyToNumber(totals.cost ?? totals.spend),
    netGmv: moneyToNumber(totals.netGmv),
    ctr: moneyToNumber(totals.ctr),
    costPerOrder: moneyToNumber(totals.costPerOrder),
    goodsFavSpend: moneyToNumber(totals.goodsFavSpend),
    mallFavSpend: moneyToNumber(totals.mallFavSpend),
    inquirySpend: moneyToNumber(totals.inquirySpend),
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
    const totals = flattenTotals(result.totalSumReport);
    const entities = result.entityReportList
      .map(flattenEntity)
      .filter(Boolean);
    return {
      entities,
      totals,
      impression: totals.impression ?? 0,
      click: totals.click ?? 0,
      ctr: totals.ctr ?? 0,
      gmv: totals.gmv ?? 0,
      spend: totals.spend ?? 0,
      cost: totals.cost ?? 0,
      netGmv: totals.netGmv ?? 0,
      costPerOrder: totals.costPerOrder ?? 0,
      raw,
    };
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
    return {
      totals: flattenTotals(result.sumReport), hourlyPoints: result.hourlyPoints,
      anchorPoints: result.anchorPoints ?? {}, raw,
    };
  },
  isSuccess: hasSuccessfulResult,
};
