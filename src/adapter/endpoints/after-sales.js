import { PDD_HOME } from '../auth-state.js';
import { responseShapeError } from '../../infra/errors.js';
import { resultObject } from './_shared.js';

export const AFTER_SALES_PAGE_SIZE = 100;
export const AFTER_SALES_MAX_PAGES = 20;

export const AFTER_SALES_STATUS_FILTERS = {
  all: null,
  open: [1, 2, 3, 4, 7, 9, 10, 11, 14, 15, 18, 21, 22, 27, 31, 32],
  refunded: [5],
  closed: [6, 12, 17, 24],
};
export const AFTER_SALES_CLI_STATUSES = Object.freeze(Object.keys(AFTER_SALES_STATUS_FILTERS));
export const AFTER_SALES_DEFAULT_STATUS = 'all';

export const AFTER_SALES_TYPE_FILTERS = { all: null, refund: 1, return_refund: 2, exchange: 3, resend: 4, repair: 5 };
export const AFTER_SALES_CLI_TYPES = Object.freeze(Object.keys(AFTER_SALES_TYPE_FILTERS));
export const AFTER_SALES_DEFAULT_TYPE = 'all';

export const AFTER_SALES_LIST = {
  name: 'after_sales.list',
  fixtureListKey: 'result.list',
  strategy: 'page-api',
  nav: { url: PDD_HOME },
  apiUrl: '/mercury/mms/afterSales/queryList',
  buildPayload: (params = {}) => ({
    pageNumber: params.page ?? 1,
    pageSize: params.pageSize ?? AFTER_SALES_PAGE_SIZE,
    orderByCreatedAtDesc: true,
    ...(Number.isFinite(params.startCreatedTime) ? { startCreatedTime: params.startCreatedTime } : {}),
    ...(Number.isFinite(params.endCreatedTime) ? { endCreatedTime: params.endCreatedTime } : {}),
    ...(typeof params.searchText === 'string' && params.searchText.length > 0 ? { searchText: params.searchText } : {}),
    ...(Array.isArray(params.afterSalesStatusList) && params.afterSalesStatusList.length > 0
      ? { afterSalesStatusList: [...params.afterSalesStatusList] } : {}),
    ...(Number.isInteger(params.afterSalesType) ? { afterSalesType: params.afterSalesType } : {}),
  }),
  normalize(raw) {
    const result = resultObject(raw, 'after_sales.list');
    if (!Number.isInteger(result.total) || result.total < 0 || !Array.isArray(result.list)) {
      throw responseShapeError('after_sales.list', 'result.total non-negative integer and result.list array');
    }
    return { total: result.total, items: result.list };
  },
};

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export const AFTER_SALES_PARAMS = {
  name: 'after_sales.params',
  strategy: 'page-api',
  nav: { url: PDD_HOME },
  apiUrl: '/mercury/mms/afterSales/queryParams',
  buildPayload: () => ({}),
  normalize(raw) {
    const result = resultObject(raw, 'after_sales.params');
    if (!isPlainObject(result) || !isPlainObject(result.reasonCodeParams)) {
      throw responseShapeError('after_sales.params', 'result.reasonCodeParams object');
    }
    const entries = [];
    for (const [category, codes] of Object.entries(result.reasonCodeParams)) {
      if (!Array.isArray(codes)) {
        throw responseShapeError('after_sales.params', 'result.reasonCodeParams category arrays');
      }
      for (const code of codes) entries.push([String(code), category]);
    }
    return { reasonCategoryMap: Object.fromEntries(entries) };
  },
};
