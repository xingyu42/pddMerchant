import { runEndpoint } from '../adapter/run-endpoint.js';
import { TRAFFIC_READY_TIME, TRAFFIC_OVERVIEW } from '../adapter/endpoints/traffic.js';
import { throwIfAborted } from '../infra/abort.js';
import { mallIdOf } from './views/_shared.js';
import { toTrafficView, TRAFFIC_REPORT } from './views/traffic.js';
import { runReport } from './operating-report.js';
import { windowEndingAt } from './report-windows.js';

export { TRAFFIC_REPORT };

// 窗口截止日取平台流量就绪日；未就绪日期会让商品明细返回空列表
export async function readTrafficWindow(ctx, days) {
  throwIfAborted(ctx.signal);
  const end = await runEndpoint(ctx.page, TRAFFIC_READY_TIME, {}, ctx);
  return windowEndingAt(days, end);
}

export async function getTrafficView(ctx, { days = TRAFFIC_REPORT.days.default } = {}) {
  return runReport(ctx, TRAFFIC_REPORT, { days, window: async () => readTrafficWindow(ctx, days) }, async (report) => {
    const { window } = report;
    const { start_date: start, end_date: end } = window;
    const rows = await runEndpoint(ctx.page, TRAFFIC_OVERVIEW, { beginDate: start, endDate: end }, ctx);
    return toTrafficView(rows.filter((row) => row.statDate >= start && row.statDate <= end),
      { window, mallId: mallIdOf(ctx) });
  });
}
