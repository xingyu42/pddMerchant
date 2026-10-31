import { runEndpoint } from '../adapter/run-endpoint.js';
import { CS_OVERVIEW, CS_MONTH_TREND } from '../adapter/endpoints/customer-service.js';
import { ExitCodes, PddCliError } from '../infra/errors.js';
import { throwIfAborted } from '../infra/abort.js';
import { toLocalDate } from '../infra/units.js';
import { mallIdOf } from './views/_shared.js';
import { toCustomerServiceView } from './views/customer-service.js';

function dateWindow(days) {
  if (!Number.isInteger(days) || days < 1 || days > 63) {
    throw new PddCliError({ code: 'E_USAGE', message: '--days 需为 1-63 的整数', exitCode: ExitCodes.USAGE });
  }
  const today = Date.parse(`${toLocalDate(Date.now())}T00:00:00Z`);
  return { start_date: new Date(today - days * 86400000).toISOString().slice(0, 10),
    end_date: new Date(today - 86400000).toISOString().slice(0, 10), days };
}

async function collectTrend(ctx, window, hints) {
  try {
    throwIfAborted(ctx.signal);
    const items = await runEndpoint(ctx.page, CS_MONTH_TREND, {}, ctx);
    throwIfAborted(ctx.signal);
    return { items: items.filter((item) => item.statDate >= window.start_date && item.statDate <= window.end_date) };
  } catch (error) {
    throwIfAborted(ctx.signal);
    if (error?.code === 'E_TIMEOUT' || error?.name === 'AbortError') throw error;
    if (!(error instanceof PddCliError)) throw error;
    hints.push('trend_unavailable');
    return null;
  }
}

export async function getCustomerServiceView(ctx, { days = 30 } = {}) {
  const window = dateWindow(days);
  const hints = [];
  throwIfAborted(ctx.signal);
  const info = await runEndpoint(ctx.page, CS_OVERVIEW,
    { startDate: window.start_date, endDate: window.end_date }, ctx);
  const trend = await collectTrend(ctx, window, hints);
  throwIfAborted(ctx.signal);
  return toCustomerServiceView(info, { window, trend, hints, mallId: mallIdOf(ctx) });
}
