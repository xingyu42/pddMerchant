import {
  AFTER_SALES_DEFAULT_STATUS, AFTER_SALES_DEFAULT_TYPE, AFTER_SALES_LIST, AFTER_SALES_MAX_PAGES,
  AFTER_SALES_PAGE_SIZE, AFTER_SALES_PARAMS, AFTER_SALES_STATUS_FILTERS, AFTER_SALES_TYPE_FILTERS,
} from '../adapter/endpoints/after-sales.js';
import { runEndpoint } from '../adapter/run-endpoint.js';
import { throwIfAborted } from '../infra/abort.js';
import { toFiniteNumber } from '../infra/units.js';
import { createReport, reportHints } from './operating-report.js';
import { rollingSecondsWindow } from './report-windows.js';
import { mallIdOf } from './views/_shared.js';
import { AFTER_SALES_REPORT, toAfterSalesCaseView, toAfterSalesListView } from './views/after-sales.js';

export {
  AFTER_SALES_CLI_STATUSES, AFTER_SALES_CLI_TYPES, AFTER_SALES_DEFAULT_STATUS, AFTER_SALES_DEFAULT_TYPE,
} from '../adapter/endpoints/after-sales.js';

async function collectAfterSalesPages(ctx, params) {
  const items = [];
  let total = 0;
  let page = 1;
  for (; page <= AFTER_SALES_MAX_PAGES; page++) {
    throwIfAborted(ctx.signal);
    const result = await runEndpoint(ctx.page, AFTER_SALES_LIST, {
      ...params, page, pageSize: AFTER_SALES_PAGE_SIZE,
    }, ctx);
    throwIfAborted(ctx.signal);
    if (page === 1) total = result.total;
    items.push(...result.items);
    if (result.items.length < AFTER_SALES_PAGE_SIZE || items.length >= total || page === AFTER_SALES_MAX_PAGES) break;
  }
  return { items, total, truncated: page === AFTER_SALES_MAX_PAGES && items.length < total };
}

function collectAfterSalesParams(ctx, report) {
  return report.optional('params_unavailable',
    () => runEndpoint(ctx.page, AFTER_SALES_PARAMS, {}, ctx),
    () => ({ reasonCategoryMap: {} }));
}

export async function getOrderAfterSalesCases(ctx, orderSn) {
  const report = createReport(ctx, AFTER_SALES_REPORT);
  const searchText = String(orderSn);
  const result = await report.optional('cases_unavailable', () => collectAfterSalesPages(ctx, { searchText }));
  if (result === null) return { cases: null, hints: reportHints(AFTER_SALES_REPORT, report.hints) };

  const matchedItems = result.items.filter((item) => String(item?.orderSn ?? '') === searchText);
  matchedItems.sort((a, b) => (toFiniteNumber(b.createdAt) ?? 0) - (toFiniteNumber(a.createdAt) ?? 0)
    || (toFiniteNumber(b.id) ?? 0) - (toFiniteNumber(a.id) ?? 0));
  const { reasonCategoryMap } = matchedItems.length > 0 ? await collectAfterSalesParams(ctx, report) : {};
  const cases = matchedItems.map((item) => toAfterSalesCaseView(item, reasonCategoryMap));
  return { cases, hints: reportHints(AFTER_SALES_REPORT, report.hints) };
}

function resolveWindow({ days, since, until, sn }) {
  if (since != null) return { startTime: since, endTime: until ?? Math.floor(Date.now() / 1000), days: null };
  if (days == null && sn != null) return { startTime: null, endTime: null, days: null };
  const effectiveDays = days ?? AFTER_SALES_REPORT.days.default;
  return { ...rollingSecondsWindow(effectiveDays), days: effectiveDays };
}

export async function getAfterSalesView(ctx, {
  days, since, until, sn, goodsId, status = AFTER_SALES_DEFAULT_STATUS, type = AFTER_SALES_DEFAULT_TYPE,
} = {}) {
  const window = resolveWindow({ days, since, until, sn });
  const searchText = sn ?? goodsId;
  const afterSalesStatusList = AFTER_SALES_STATUS_FILTERS[status];
  const afterSalesType = AFTER_SALES_TYPE_FILTERS[type];
  const report = createReport(ctx, AFTER_SALES_REPORT);
  const { items, total, truncated } = await collectAfterSalesPages(ctx, {
    ...(window.startTime != null ? { startCreatedTime: window.startTime } : {}),
    ...(window.endTime != null ? { endCreatedTime: window.endTime } : {}),
    ...(searchText != null ? { searchText } : {}),
    ...(afterSalesStatusList != null ? { afterSalesStatusList } : {}),
    ...(afterSalesType != null ? { afterSalesType } : {}),
  });
  const filteredItems = items.filter((item) =>
    (sn == null || String(item?.orderSn ?? '') === String(sn))
    && (afterSalesStatusList == null || afterSalesStatusList.includes(toFiniteNumber(item?.afterSalesStatus)))
    && (afterSalesType == null || toFiniteNumber(item?.afterSalesType) === afterSalesType));
  const effectiveTotal = !truncated && filteredItems.length < items.length ? filteredItems.length : total;
  const { reasonCategoryMap } = await collectAfterSalesParams(ctx, report);
  if (truncated) report.hint('list_truncated');
  return toAfterSalesListView({
    rawItems: filteredItems, total: effectiveTotal, truncated, window, filters: { sn, goodsId, status, type },
    reasonCategoryMap, hints: report.hints, mallId: mallIdOf(ctx),
  });
}
