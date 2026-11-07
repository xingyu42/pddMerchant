import { runEndpoint } from '../adapter/run-endpoint.js';
import { NAVIGATOR_INFO, NAVIGATOR_READY_DATE, NAVIGATOR_LIST } from '../adapter/endpoints/experience.js';
import { mallIdOf } from './views/_shared.js';
import { toExperienceView, EXPERIENCE_REPORT } from './views/experience.js';
import { runReport } from './operating-report.js';
import { windowEndingAt } from './report-windows.js';

export { EXPERIENCE_REPORT };

async function collectTrend(ctx, readyDate, days, report) {
  if (readyDate === null) return null;
  const window = windowEndingAt(days, readyDate);
  report.window = window;
  const items = await report.optional('trend_unavailable', async () => runEndpoint(ctx.page, NAVIGATOR_LIST,
    { beginDate: window.start_date, endDate: window.end_date }, ctx));
  if (items === null) return null;
  return { ...window, items: items.filter((item) => item.pt >= window.start_date && item.pt <= window.end_date) };
}

export async function getShopExperienceView(ctx, { days = EXPERIENCE_REPORT.days.default } = {}) {
  return runReport(ctx, EXPERIENCE_REPORT, { days }, async (report) => {
    const readyDate = await report.optional('ready_date_unavailable', async () =>
      runEndpoint(ctx.page, NAVIGATOR_READY_DATE, {}, ctx));
    const info = await runEndpoint(ctx.page, NAVIGATOR_INFO, {}, ctx);
    const trend = await collectTrend(ctx, readyDate, days, report);
    return toExperienceView(info, { trend, hints: report.hints, mallId: mallIdOf(ctx) });
  });
}
