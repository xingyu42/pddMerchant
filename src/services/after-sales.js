import {
  AFTER_SALES_LIST, AFTER_SALES_MAX_PAGES, AFTER_SALES_PAGE_SIZE, AFTER_SALES_PARAMS,
} from '../adapter/endpoints/after-sales.js';
import { runEndpoint } from '../adapter/run-endpoint.js';
import { throwIfAborted } from '../infra/abort.js';
import { createReport } from './operating-report.js';
import { rollingSecondsWindow } from './report-windows.js';
import { mallIdOf } from './views/_shared.js';
import { AFTER_SALES_REPORT, toAfterSalesListView } from './views/after-sales.js';

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

export async function getAfterSalesView(ctx, { days } = {}) {
  const effectiveDays = days ?? AFTER_SALES_REPORT.days.default;
  const window = { ...rollingSecondsWindow(effectiveDays), days: effectiveDays };
  const report = createReport(ctx, AFTER_SALES_REPORT);
  const { items, total, truncated } = await collectAfterSalesPages(ctx, {
    startCreatedTime: window.startTime, endCreatedTime: window.endTime,
  });
  const { reasonCategoryMap } = await report.optional('params_unavailable',
    () => runEndpoint(ctx.page, AFTER_SALES_PARAMS, {}, ctx),
    () => ({ reasonCategoryMap: {} }));
  if (truncated) report.hint('list_truncated');
  return toAfterSalesListView({
    rawItems: items, total, truncated, window, reasonCategoryMap, hints: report.hints, mallId: mallIdOf(ctx),
  });
}
