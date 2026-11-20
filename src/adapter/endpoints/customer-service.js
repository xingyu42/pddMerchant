import { responseShapeError } from '../../infra/errors.js';
import { TIMEOUTS } from '../../infra/timeouts.js';

const FIELDS = ['consultUserCnt', 'needManuReplyConsultUserCnt', 'receiveUserCnt',
  'manuReplyRate3Min', 'manuReplyRate30s', 'artificialResponseTime', 'unsatisfiedServeScoreCnt',
  'serveRefundCnt', 'complainCsUserCnt'];
const TREND_FIELDS = ['statDate', ...FIELDS, 'avgReplyTimeTop10', 'avgReplyTimeTotal'];
const SALES_FIELDS = ['inquiryOrderUserCnt', 'groupUserCnt', 'inquiryOrderTransformRate', 'csSalesAmount'];
const SALES_TREND_FIELDS = ['statDate', ...SALES_FIELDS, 'inquiryConfirmRateTop10Avg', 'inquiryConfirmRateTotalAvg'];
const NAV = { url: 'https://mms.pinduoduo.com/mms-chat/overview/service' };

function project(result, fields, endpoint) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw responseShapeError(endpoint, 'result object');
  }
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(result, field))
    .map((field) => [field, result[field]]));
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
  normalize: (raw) => project(raw?.result, SALES_FIELDS, 'cs.salesOverview'),
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
    return raw.result.map((item) => project(item, SALES_TREND_FIELDS, 'cs.monthSalesTrend'));
  },
};
