import { readBusinessError } from '../run-endpoint.js';
import { ExitCodes, PddCliError, responseShapeError } from '../../infra/errors.js';
import { toFiniteNumber } from '../../infra/units.js';

const FLOW_FIELDS = ['uv', 'pv', 'guv', 'gpv', 'payOrdrUsrCnt', 'payOrdrCnt', 'payOrdrAmt', 'payUvRto', 'payOrdrAup', 'uvCfmVal'];
const FLOW_METRIC_FIELDS = FLOW_FIELDS.flatMap((key) => [key, `${key}1dPln`, `${key}1dOst`]);
const GOODS_FIELDS = ['goodsUv', 'goodsPv', 'goodsFavCnt', 'ordrCrtUsrCnt', 'ordrVstrRto', 'goodsVcr',
  'payOrdrRto', 'payOrdrCnt', 'payOrdrGoodsQty', 'payOrdrUsrCnt', 'payOrdrAmt', 'cnsltUsrQty'];

function requireDate(value, endpoint) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw responseShapeError(endpoint, 'YYYY-MM-DD date');
  }
  return value;
}

// Only numeric fields (and goodsId) are checked for obfuscated-font glyphs; free text such as goodsName may legitimately contain PUA chars.
function project(row, fields, numericFields, endpoint) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw responseShapeError(endpoint, 'row object');
  for (const field of numericFields) {
    if (typeof row[field] === 'string' && /[\uE000-\uF8FF]/.test(row[field])) {
      throw new PddCliError({ code: 'E_BUSINESS', message: '平台返回字体混淆数据',
        hint: '明文流量接口已变化，请核验平台接口', exitCode: ExitCodes.BUSINESS });
    }
  }
  return Object.fromEntries(fields.filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]]));
}

function endpoint(name, apiUrl, nav, normalize, buildPayload) {
  return { name, apiUrl, nav: { url: `https://mms.pinduoduo.com${nav}` }, strategy: 'page-api',
    fixtureIsServiceFacing: true, normalize, buildPayload,
    isSuccess: (raw) => raw?.success === true && raw?.errorCode === 1000000,
    errorMapper(raw) {
      const error = readBusinessError(raw);
      return error ? { code: 'E_BUSINESS', message: error.message, exitCode: ExitCodes.BUSINESS } : null;
    } };
}

export const TRAFFIC_READY_TIME = endpoint('traffic.readyTime', '/sydney/api/mallFlow/queryMallFlowOverViewReadyTime',
  '/sycm/search_data/plate', (raw) => {
    return requireDate(raw?.result, 'traffic.readyTime');
  }, () => ({}));

export const TRAFFIC_OVERVIEW = endpoint('traffic.overviewList', '/sydney/api/mallFlow/queryMallFlowOverViewList',
  '/sycm/search_data/plate', (raw) => {
    if (!Array.isArray(raw?.result)) throw responseShapeError('traffic.overviewList', 'result array');
    return raw.result.map((row) => {
      requireDate(row?.statDate, 'traffic.overviewList');
      return project(row, ['statDate', ...FLOW_METRIC_FIELDS], FLOW_METRIC_FIELDS, 'traffic.overviewList');
    });
  }, ({ beginDate, endDate }) => ({ beginDate, endDate }));

export const GOODS_TRAFFIC_LIST = {
  ...endpoint('traffic.goodsDetailList', '/sydney/api/goodsDataShow/queryGoodsDetailVOList', '/sycm/goods_effect', (raw) => {
    const result = raw?.result;
    const total = toFiniteNumber(result?.totalNum);
    if (!Array.isArray(result?.goodsDetailList) || total === null || total < 0 || !Number.isInteger(total)) {
      throw responseShapeError('traffic.goodsDetailList', 'result.goodsDetailList / totalNum');
    }
    const items = result.goodsDetailList.map((row) => {
      if (row?.goodsId == null || String(row.goodsId).trim() === '') throw responseShapeError('traffic.goodsDetailList', 'goodsId');
      return project(row, ['goodsId', 'goodsName', 'cate3Name', ...GOODS_FIELDS], ['goodsId', ...GOODS_FIELDS],
        'traffic.goodsDetailList');
    });
    return { total, items };
  }, ({ startDate, endDate, queryType, page = 1, goodsId }) => ({
    startDate, endDate, queryType, sortCol: 0, sortType: 1, pageNum: page, pageSize: 50,
    ...(goodsId == null ? {} : { goodsId }),
  })), fixtureListKey: 'items',
};
