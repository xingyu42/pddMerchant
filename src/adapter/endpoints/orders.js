import { readBusinessError } from '../run-endpoint.js';
import { ExitCodes } from '../../infra/errors.js';

export const ORDER_LIST = {
  name: 'orders.list',
  urlPattern: /mangkhut\/mms\/recentOrderList/,
  apiUrl: '/mangkhut/mms/recentOrderList',
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

const NOT_FOUND_HINTS = ['订单不存在', '未找到', '无此订单', 'not found', 'not_found'];

function matchesNotFound(message) {
  if (typeof message !== 'string' || message.length === 0) return false;
  const lowered = message.toLowerCase();
  return NOT_FOUND_HINTS.some((hint) => lowered.includes(hint));
}

export const ORDER_DETAIL = {
  name: 'orders.detail',
  urlPattern: /mangkhut\/mms\/orderDetail/,
  nav: {
    url: 'https://mms.pinduoduo.com/orders/list',
    readyEl: 'body',
  },
  trigger: async (page, params) => {
    await page.evaluate(({ order_sn, source }) => {
      return fetch('/mangkhut/mms/orderDetail', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_sn, source: source || 'MMS' }),
      });
    }, { order_sn: params.order_sn, source: params.source });
  },
  requiredTrigger: true,
  errorMapper: (raw) => {
    const biz = readBusinessError(raw);
    if (!biz) return null;
    if (biz.code === '1000') {
      return { code: 'E_USAGE', message: biz.message || '订单号不能为空', exitCode: ExitCodes.USAGE };
    }
    if (biz.code === '54001') {
      return { code: 'E_RATE_LIMIT', message: biz.message || '操作太过频繁', exitCode: ExitCodes.RATE_LIMIT };
    }
    if (matchesNotFound(biz.message)) {
      return { code: 'E_NOT_FOUND', message: biz.message, exitCode: ExitCodes.BUSINESS };
    }
    return null;
  },
  normalize: (raw) => ({ order: raw?.result ?? null, raw }),
  isSuccess: (raw) => {
    if (!raw || typeof raw !== 'object') return false;
    if (raw.success === true) return true;
    const code = raw.error_code ?? raw.errorCode;
    if (code === 0 || code === 1000000) return true;
    return false;
  },
};

export const ORDER_STATS = {
  name: 'orders.stats',
  urlPattern: /mars\/app\/order\/statisticWithType/,
  apiUrl: '/mars/app/order/statisticWithType',
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
