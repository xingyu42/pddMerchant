import { runEndpoint } from '../adapter/run-endpoint.js';
import { CS_OVERVIEW, CS_MONTH_TREND, CS_SALES_OVERVIEW, CS_MONTH_SALES_TREND } from '../adapter/endpoints/customer-service.js';
import { mallIdOf } from './views/_shared.js';
import { toCustomerServiceView, CUSTOMER_SERVICE_REPORT } from './views/customer-service.js';
import { runReport } from './operating-report.js';
import { windowEndingDaysAgo, windowEndingYesterday } from './report-windows.js';

export { CUSTOMER_SERVICE_REPORT };

// 平台只提供 3 天之前的销售数据：询单后 3 日内的下单都计入询单当日。
const SALES_LAG_DAYS = 3;
// 销售数据页自定义日期的可选范围是 [今天-64, 今天-3]，共 62 天；更长的 --days 收到这个范围。
const SALES_MAX_DAYS = 62;
const withinWindow = (window) => (item) => item.statDate >= window.start_date && item.statDate <= window.end_date;

// 区间汇总取平台的区间接口；逐日接口固定返回约 31 天，单独失败时保留汇总。
async function collectSales(ctx, report, days) {
  const window = windowEndingDaysAgo(Math.min(days, SALES_MAX_DAYS), SALES_LAG_DAYS);
  const summary = await runEndpoint(ctx.page, CS_SALES_OVERVIEW,
    { startDate: window.start_date, endDate: window.end_date }, ctx);
  const trend = await report.optional('sales_trend_unavailable', async () => {
    const items = await runEndpoint(ctx.page, CS_MONTH_SALES_TREND, {}, ctx);
    return { items: items.filter(withinWindow(window)) };
  });
  return { window, summary, trend };
}

export async function getCustomerServiceView(ctx, { days = CUSTOMER_SERVICE_REPORT.days.default } = {}) {
  return runReport(ctx, CUSTOMER_SERVICE_REPORT, { days, window: windowEndingYesterday }, async (report) => {
    const { window, hints } = report;
    const info = await runEndpoint(ctx.page, CS_OVERVIEW,
      { startDate: window.start_date, endDate: window.end_date }, ctx);
    const trend = await report.optional('trend_unavailable', async () => {
      const items = await runEndpoint(ctx.page, CS_MONTH_TREND, {}, ctx);
      return { items: items.filter(withinWindow(window)) };
    });
    const sales = await report.optional('sales_unavailable', () => collectSales(ctx, report, window.days));
    return toCustomerServiceView(info, { window, trend, sales, hints, mallId: mallIdOf(ctx) });
  });
}
