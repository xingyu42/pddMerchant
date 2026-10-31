import { readBusinessError } from '../run-endpoint.js';
import { ExitCodes, responseShapeError } from '../../infra/errors.js';

const FIELDS = ['consultUserCnt', 'needManuReplyConsultUserCnt', 'receiveUserCnt',
  'manuReplyRate3Min', 'manuReplyRate30s', 'artificialResponseTime', 'unsatisfiedServeScoreCnt',
  'serveRefundCnt', 'complainCsUserCnt'];
const TREND_FIELDS = ['statDate', ...FIELDS, 'avgReplyTimeTop10', 'avgReplyTimeTotal'];
const NAV = { url: 'https://mms.pinduoduo.com/mms-chat/overview/service' };

function project(result, fields, endpoint) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw responseShapeError(endpoint, 'result object');
  }
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(result, field))
    .map((field) => [field, result[field]]));
}

const COMMON = {
  fixtureIsServiceFacing: true, nav: NAV,
  isSuccess: (raw) => raw?.success === true && raw?.errorCode === 1000000,
  errorMapper(raw) {
    const error = readBusinessError(raw);
    return error ? { code: 'E_BUSINESS', message: error.message, exitCode: ExitCodes.BUSINESS } : null;
  },
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
