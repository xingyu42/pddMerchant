import { readBusinessError, SUCCESS_BUSINESS_CODES } from '../run-endpoint.js';
import { ExitCodes, responseShapeError } from '../../infra/errors.js';

const VALUE_FIELDS = [
  'ptHelpRate1m', 'aprsIn3minRplyUsrRto1m', 'rfSignTime1m', 'rfProcTime1m', 'dsr3m',
  'posTypeRto1m', 'seriousInferiorRto1m', 'adjNfkAvgCfmSignTime1m', 'lgstMergeFine1m', 'gmvRk',
];
const FIELDS = [
  'mallStarTomms', 'mallStarTommsChange', 'mallStarTommsNext', 'mallStarTommsNextPct',
  'scoreRk', 'scoreDsc', 'mallStarDesc', 'stplName', 'normalFlag', 'delayData',
  'isRps', 'isRequireRps', 'isRpsNextStarRkDesc',
  ...VALUE_FIELDS.flatMap((field) => [field, `${field}NextPctThreshold`, `${field}NextStarRkDesc`]),
];

function project(result, dateField, endpoint) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw responseShapeError(endpoint, 'result object');
  }
  return Object.fromEntries([dateField, ...FIELDS]
    .filter((field) => Object.hasOwn(result, field)).map((field) => [field, result[field]]));
}

function readyDate(raw) {
  const value = raw?.result;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw responseShapeError('experience.navigatorReadyDate', 'result YYYY-MM-DD');
  }
  return value;
}

function endpoint(name, suffix, normalize, buildPayload = () => ({})) {
  return {
    name: `experience.${name}`, fixtureIsServiceFacing: true, strategy: 'page-api',
    nav: { url: 'https://mms.pinduoduo.com/sycm/goods_quality/pilot_mall' },
    apiUrl: `/sydney/api/mallNavigator/queryUpgradeMallNavigator${suffix}`,
    buildPayload, normalize,
    isSuccess: (raw) => raw?.success === true && SUCCESS_BUSINESS_CODES.has(raw?.errorCode),
    errorMapper(raw) {
      const error = readBusinessError(raw);
      return error ? { code: 'E_BUSINESS', message: error.message, exitCode: ExitCodes.BUSINESS } : null;
    },
  };
}

export const NAVIGATOR_INFO = endpoint('navigatorInfo', 'Info',
  (raw) => project(raw?.result, 'timestamp', 'experience.navigatorInfo'));
export const NAVIGATOR_READY_DATE = endpoint('navigatorReadyDate', 'ReadyDate', readyDate);
export const NAVIGATOR_LIST = endpoint('navigatorList', 'List', (raw) => {
  if (!Array.isArray(raw?.result)) throw responseShapeError('experience.navigatorList', 'result array');
  return raw.result.map((item) => project(item, 'pt', 'experience.navigatorList'));
}, ({ beginDate, endDate }) => ({ beginDate, endDate }));
