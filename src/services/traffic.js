import { runEndpoint } from '../adapter/run-endpoint.js';
import { TRAFFIC_READY_TIME, TRAFFIC_OVERVIEW } from '../adapter/endpoints/traffic.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { throwIfAborted } from '../infra/abort.js';
import { mallIdOf } from './views/_shared.js';
import { toTrafficView } from './views/traffic.js';

// 窗口截止日取平台流量就绪日；未就绪日期会让商品明细返回空列表
export async function readTrafficWindow(ctx, days) {
  throwIfAborted(ctx.signal);
  const end = await runEndpoint(ctx.page, TRAFFIC_READY_TIME, {}, ctx);
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);
  return { start_date: start, end_date: end, days };
}

export async function getTrafficView(ctx, { days = 30 } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 30) {
    throw new PddCliError({ code: 'E_USAGE', message: '--days 需为 1-30 的整数', exitCode: ExitCodes.USAGE });
  }
  const window = await readTrafficWindow(ctx, days);
  const { start_date: start, end_date: end } = window;
  const rows = await runEndpoint(ctx.page, TRAFFIC_OVERVIEW, { beginDate: start, endDate: end }, ctx);
  throwIfAborted(ctx.signal);
  return toTrafficView(rows.filter((row) => row.statDate >= start && row.statDate <= end),
    { window, mallId: mallIdOf(ctx) });
}
