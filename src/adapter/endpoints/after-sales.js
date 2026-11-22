import { PDD_HOME } from '../auth-state.js';
import { responseShapeError } from '../../infra/errors.js';
import { resultObject } from './_shared.js';

export const AFTER_SALES_PAGE_SIZE = 100;
export const AFTER_SALES_MAX_PAGES = 20;
export const AFTER_SALES_VIEW_LIMIT = AFTER_SALES_PAGE_SIZE * AFTER_SALES_MAX_PAGES;

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
