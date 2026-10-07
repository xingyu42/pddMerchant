import { readBusinessError } from '../run-endpoint.js';
import { ExitCodes, responseShapeError } from '../../infra/errors.js';
import { PDD_HOME } from '../auth-state.js';

function readListResult(raw) {
  const result = raw?.result;
  if (!Number.isFinite(result?.totalItemNum) || !Array.isArray(result?.pageItems)) {
    throw responseShapeError('orders.list', 'result.totalItemNum/result.pageItems');
  }
  return result;
}

function readDetailResult(raw) {
  const result = raw?.result;
  const hasOrderSn = result?.orderSn != null || result?.order_sn != null;
  if (!result || typeof result !== 'object' || Array.isArray(result) || !hasOrderSn) {
    throw responseShapeError('orders.detail', 'result order object with orderSn/order_sn');
  }
  return result;
}

const ORDER_STAT_FIELDS = ['unship', 'unship12h', 'delay', 'unreceive'];

function readStatsResult(raw) {
  const result = raw?.result;
  if (!result || ORDER_STAT_FIELDS.some((field) => !Number.isFinite(result[field]))) {
    throw responseShapeError('orders.stats', `numeric result.${ORDER_STAT_FIELDS.join('/result.')}`);
  }
  return result;
}

// 订单列表默认时间窗（天）：未指定 since 时的查询起点
export const ORDER_LIST_DEFAULT_DAYS = 7;

export const ORDER_LIST = {
  name: 'orders.list',
  fixtureIsServiceFacing: true,
  strategy: 'page-api',
  nav: { url: PDD_HOME },
  apiUrl: '/mangkhut/mms/recentOrderList',
  buildPayload: (params = {}) => ({
    orderType: params.orderType ?? 2,
    afterSaleType: 1,
    remarkStatus: -1,
    urgeShippingStatus: -1,
    groupStartTime: params.since ?? Math.floor((Date.now() - ORDER_LIST_DEFAULT_DAYS * 86400000) / 1000),
    groupEndTime: params.until ?? Math.floor(Date.now() / 1000),
    pageNumber: params.page ?? 1,
    pageSize: params.size ?? 20,
    sortType: 11,
    hideRegionBlackDelayShipping: false,
    mobile: '',
  }),
  normalize: (raw) => {
    const result = readListResult(raw);
    return { total: result.totalItemNum, orders: result.pageItems, raw };
  },
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
  fixtureIsServiceFacing: true,
  strategy: 'page-api',
  apiUrl: '/mangkhut/mms/orderDetail',
  buildPayload: (params = {}) => ({
    orderSn: params.order_sn,
    source: params.source || 'MMS',
  }),
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
  normalize: (raw) => ({ order: readDetailResult(raw), raw }),
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
  fixtureIsServiceFacing: true,
  strategy: 'page-api',
  // diagnose 在新开的空白页上并发采集统计，必须先初始化商家运行时，否则 page API client 不可用
  nav: { url: PDD_HOME },
  apiUrl: '/mars/app/order/statisticWithType',
  buildPayload: () => ({ subType: 5, additionalTypeSet: [] }),
  normalize: (raw) => {
    const result = readStatsResult(raw);
    return {
      unship: result.unship,
      unship12h: result.unship12h,
      delay: result.delay,
      unreceive: result.unreceive,
      raw,
    };
  },
  isSuccess: (raw) => raw?.success === true,
};
