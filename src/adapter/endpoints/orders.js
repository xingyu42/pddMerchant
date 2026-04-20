export const ORDER_LIST = {
  name: 'orders.list',
  urlPattern: /mangkhut\/mms\/recentOrderList/,
  nav: {
    url: 'https://mms.pinduoduo.com/orders/list',
    readyEl: 'button:has-text("查询")',
  },
  trigger: async (page) => {
    try {
      await page.click('button:has-text("查询")', { timeout: 5000 });
    } catch {
      // 页面可能已自动加载，collector 仍能从 networkidle 前的首次 XHR 捕获
    }
  },
  buildPayload: (params = {}) => ({
    orderType: params.orderType ?? 2,
    afterSaleType: 1,
    remarkStatus: -1,
    urgeShippingStatus: -1,
    groupStartTime: params.since ?? Math.floor((Date.now() - 7 * 86400000) / 1000),
    groupEndTime: params.until ?? Math.floor(Date.now() / 1000),
    pageNumber: params.page ?? 1,
    pageSize: params.size ?? 20,
    sortType: 11,
    hideRegionBlackDelayShipping: false,
    mobile: '',
  }),
  normalize: (raw) => ({
    total: raw?.result?.totalItemNum ?? 0,
    orders: raw?.result?.pageItems ?? [],
    raw,
  }),
  isSuccess: (raw) => raw?.success === true,
};

export const ORDER_STATS = {
  name: 'orders.stats',
  urlPattern: /mars\/app\/order\/statisticWithType/,
  nav: {
    url: 'https://mms.pinduoduo.com/orders/list',
    readyEl: 'button:has-text("查询")',
  },
  trigger: async (page) => {
    try {
      await page.click('button:has-text("查询")', { timeout: 5000 });
    } catch {
      // 自动加载兜底
    }
  },
  buildPayload: () => ({ subType: 5, additionalTypeSet: [] }),
  normalize: (raw) => ({
    unship: raw?.result?.unship ?? 0,
    unship12h: raw?.result?.unship12h ?? 0,
    delay: raw?.result?.delay ?? 0,
    unreceive: raw?.result?.unreceive ?? 0,
    raw,
  }),
  isSuccess: (raw) => raw?.success === true,
};
