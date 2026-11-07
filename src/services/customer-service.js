import { runEndpoint } from '../adapter/run-endpoint.js';
import { CS_OVERVIEW, CS_MONTH_TREND } from '../adapter/endpoints/customer-service.js';
import { mallIdOf } from './views/_shared.js';
import { toCustomerServiceView, CUSTOMER_SERVICE_REPORT } from './views/customer-service.js';
import { runReport } from './operating-report.js';
import { windowEndingYesterday } from './report-windows.js';

export { CUSTOMER_SERVICE_REPORT };

export async function getCustomerServiceView(ctx, { days = CUSTOMER_SERVICE_REPORT.days.default } = {}) {
  return runReport(ctx, CUSTOMER_SERVICE_REPORT, { days, window: windowEndingYesterday }, async (report) => {
    const { window, hints } = report;
    const info = await runEndpoint(ctx.page, CS_OVERVIEW,
      { startDate: window.start_date, endDate: window.end_date }, ctx);
    const trend = await report.optional('trend_unavailable', async () => {
      const items = await runEndpoint(ctx.page, CS_MONTH_TREND, {}, ctx);
      return { items: items.filter((item) => item.statDate >= window.start_date && item.statDate <= window.end_date) };
    });
    return toCustomerServiceView(info, { window, trend, hints, mallId: mallIdOf(ctx) });
  });
}
