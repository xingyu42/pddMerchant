import { runEndpoint } from '../adapter/run-endpoint.js';
import { TRAFFIC_READY_TIME, TRAFFIC_OVERVIEW } from '../adapter/endpoints/traffic.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { throwIfAborted } from '../infra/abort.js';
import { mallIdOf } from './views/_shared.js';
import { toTrafficView } from './views/traffic.js';

export async function getTrafficView(ctx, { days = 30 } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 30) {
    throw new PddCliError({ code: 'E_USAGE', message: '--days 需为 1-30 的整数', exitCode: ExitCodes.USAGE });
  }
  throwIfAborted(ctx.signal);
  const end = await runEndpoint(ctx.page, TRAFFIC_READY_TIME, {}, ctx);
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);
  const rows = await runEndpoint(ctx.page, TRAFFIC_OVERVIEW, { beginDate: start, endDate: end }, ctx);
  throwIfAborted(ctx.signal);
  return toTrafficView(rows.filter((row) => row.statDate >= start && row.statDate <= end),
    { window: { start_date: start, end_date: end, days }, mallId: mallIdOf(ctx) });
}
