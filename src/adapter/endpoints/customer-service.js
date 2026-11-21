import { responseShapeError } from '../../infra/errors.js';
import { TIMEOUTS } from '../../infra/timeouts.js';
import { resultObject } from './_shared.js';

const FIELDS = ['consultUserCnt', 'needManuReplyConsultUserCnt', 'receiveUserCnt',
  'manuReplyRate3Min', 'manuReplyRate30s', 'artificialResponseTime', 'unsatisfiedServeScoreCnt',
  'serveRefundCnt', 'complainCsUserCnt'];
const TREND_FIELDS = ['statDate', ...FIELDS, 'avgReplyTimeTop10', 'avgReplyTimeTotal'];
const SALES_FIELDS = ['inquiryOrderUserCnt', 'groupUserCnt', 'inquiryOrderTransformRate', 'csSalesAmount'];
const SALES_TREND_FIELDS = ['statDate', ...SALES_FIELDS, 'inquiryConfirmRateTop10Avg', 'inquiryConfirmRateTotalAvg'];
const TODAY_REALTIME_FIELDS = ['consultUserCnt', 'needReplyUserCnt', 'manuReceiveUserCnt',
  'replyRate3Min', 'replyRate3MinThreshold'];
const HOUR_CONSULT_FIELDS = ['replyUser3Min', 'unReplyUser3Min'];
const NAV = { url: 'https://mms.pinduoduo.com/mms-chat/overview/service' };

function project(result, fields, endpoint) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw responseShapeError(endpoint, 'result object');
  }
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(result, field))
    .map((field) => [field, result[field]]));
}

function requireFields(result, required, endpoint) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw responseShapeError(endpoint, 'result object');
  }
  for (const field of required) {
    if (!Object.hasOwn(result, field)) throw responseShapeError(endpoint, field);
  }
}

const COMMON = {
  nav: NAV,
  errorMap: 'upstream',
};

export const CS_OVERVIEW = {
  ...COMMON, name: 'cs.overview', strategy: 'page-api',
  apiUrl: '/desert/stat/mallServiceOverviewData',
  buildPayload: ({ startDate, endDate }) => ({ startDate, endDate }),
  normalize: (raw) => project(raw?.result, FIELDS, 'cs.overview'),
};

export const CS_MONTH_TREND = {
  ...COMMON, name: 'cs.monthTrend', urlPattern: /desert\/stat\/mallMonthServiceData/,
  normalize(raw) {
    if (!Array.isArray(raw?.result)) throw responseShapeError('cs.monthTrend', 'result array');
    return raw.result.map((item) => project(item, TREND_FIELDS, 'cs.monthTrend'));
  },
};

export const CS_SALES_OVERVIEW = {
  ...COMMON, name: 'cs.salesOverview', strategy: 'page-api',
  apiUrl: '/desert/stat/mallSalesOverviewData',
  buildPayload: ({ startDate, endDate }) => ({ startDate, endDate }),
  normalize(raw) {
    requireFields(raw?.result, SALES_FIELDS, 'cs.salesOverview');
    return project(raw.result, SALES_FIELDS, 'cs.salesOverview');
  },
};

export const CS_MONTH_SALES_TREND = {
  ...COMMON, name: 'cs.monthSalesTrend', urlPattern: /desert\/stat\/mallMonthSalesData/,
  // 逐日销售数据在切到「销售数据」页签时才请求，页面加载不会自动发出。
  requiredTrigger: true,
  trigger: async (page) => {
    await page.getByText('销售数据', { exact: true }).first().click({ timeout: TIMEOUTS.ELEMENT_READY });
  },
  normalize(raw) {
    if (!Array.isArray(raw?.result)) throw responseShapeError('cs.monthSalesTrend', 'result array');
    return raw.result.map((item) => {
      if (typeof item?.statDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.statDate)) {
        throw responseShapeError('cs.monthSalesTrend', 'statDate YYYY-MM-DD');
      }
      requireFields(item, SALES_FIELDS, 'cs.monthSalesTrend');
      return project(item, SALES_TREND_FIELDS, 'cs.monthSalesTrend');
    });
  },
};

export const CS_TODAY_REALTIME = {
  ...COMMON, name: 'cs.todayRealtime', strategy: 'page-api', method: 'GET',
  apiUrl: '/desert/stat/mallServiceRealTimeData',
  buildPayload: () => ({}),
  normalize(raw) {
    requireFields(raw?.result, TODAY_REALTIME_FIELDS, 'cs.todayRealtime');
    return project(raw.result, TODAY_REALTIME_FIELDS, 'cs.todayRealtime');
  },
};

export const CS_TODAY_UNREPLY = {
  ...COMMON, name: 'cs.todayUnreply', strategy: 'page-api', method: 'GET',
  apiUrl: '/chats/cs/unreplyUser/count',
  buildPayload: () => ({}),
  normalize(raw) {
    requireFields(raw?.result, ['unreply_num'], 'cs.todayUnreply');
    return project(raw.result, ['unreply_num'], 'cs.todayUnreply');
  },
};

export const CS_TODAY_HOUR_CONSULT = {
  ...COMMON, name: 'cs.todayHourConsult', strategy: 'page-api',
  apiUrl: '/desert/stat/getMallHourConsultData',
  buildPayload: ({ startDate, endDate }) => ({ startDate, endDate }),
  normalize(raw) {
    const result = resultObject(raw, 'cs.todayHourConsult');
    if (!Array.isArray(result.list)) throw responseShapeError('cs.todayHourConsult', 'result.list array');
    return result.list.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)
        || !Number.isInteger(item.hour) || item.hour < 0 || item.hour > 23) {
        throw responseShapeError('cs.todayHourConsult', 'hour 0..23');
      }
      requireFields(item, HOUR_CONSULT_FIELDS, 'cs.todayHourConsult');
      return project(item, ['hour', ...HOUR_CONSULT_FIELDS], 'cs.todayHourConsult');
    });
  },
};
