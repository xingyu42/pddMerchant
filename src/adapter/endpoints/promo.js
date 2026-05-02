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

export const PROMO_ENTITY_REPORT = {
  name: 'promo.entityReport',
  urlPattern: /apollo\/api\/report\/queryEntityReport/,
  apiUrl: '/apollo/api/report/queryEntityReport',
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
    const totals = raw?.result?.totalSumReport ?? {};
    return {
      entities: raw?.result?.entityReportList ?? [],
      totals,
      impression: totals.impression ?? 0,
      click: totals.click ?? 0,
      ctr: totals.ctr ?? 0,
      gmv: totals.gmv ?? 0,
      netGmv: totals.netGmv ?? 0,
      costPerOrder: totals.costPerOrder ?? 0,
      raw,
    };
  },
  isSuccess: (raw) => raw?.result !== undefined,
};

export const PROMO_HOURLY_REPORT = {
  name: 'promo.hourlyReport',
  urlPattern: /apollo\/api\/report\/queryHourlyRangeReport/,
  apiUrl: '/apollo/api/report/queryHourlyRangeReport',
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
  normalize: (raw) => ({
    totals: raw?.result?.sumReport ?? {},
    hourlyPoints: raw?.result?.hourlyPoints ?? [],
    anchorPoints: raw?.result?.anchorPoints ?? {},
    raw,
  }),
  isSuccess: (raw) => raw?.result !== undefined,
};
