import { runEndpoint } from '../adapter/run-endpoint.js';
import { NAVIGATOR_INFO, NAVIGATOR_READY_DATE, NAVIGATOR_LIST } from '../adapter/endpoints/experience.js';
import { ExitCodes, PddCliError } from '../infra/errors.js';
import { throwIfAborted } from '../infra/abort.js';
import { mallIdOf } from './views/_shared.js';
import { toExperienceView } from './views/experience.js';

function validateDays(days) {
  if (!Number.isInteger(days) || days < 1 || days > 30) {
    throw new PddCliError({ code: 'E_USAGE', message: '--days 需为 1–30 的整数', exitCode: ExitCodes.USAGE });
  }
}

async function optionalEndpoint(ctx, spec, params, hints, failureHint) {
  try {
    throwIfAborted(ctx.signal);
    const result = await runEndpoint(ctx.page, spec, params, ctx);
    throwIfAborted(ctx.signal);
    return result;
  } catch (error) {
    throwIfAborted(ctx.signal);
    if (error?.code === 'E_TIMEOUT' || error?.name === 'AbortError') throw error;
    if (!(error instanceof PddCliError)) throw error;
    hints.push(failureHint);
    return null;
  }
}

function dateWindow(endDate, days) {
  const start = new Date(`${endDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { start_date: start.toISOString().slice(0, 10), end_date: endDate, days };
}

async function collectTrend(ctx, readyDate, days, hints) {
  if (readyDate === null) return null;
  const window = dateWindow(readyDate, days);
  const items = await optionalEndpoint(ctx, NAVIGATOR_LIST,
    { beginDate: window.start_date, endDate: window.end_date }, hints, 'trend_unavailable');
  if (items === null) return null;
  return { ...window, items: items.filter((item) => item.pt >= window.start_date && item.pt <= window.end_date) };
}

export async function getShopExperienceView(ctx, { days = 7 } = {}) {
  validateDays(days);
  const hints = [];
  const readyDate = await optionalEndpoint(ctx, NAVIGATOR_READY_DATE, {}, hints, 'ready_date_unavailable');
  const info = await runEndpoint(ctx.page, NAVIGATOR_INFO, {}, ctx);
  const trend = await collectTrend(ctx, readyDate, days, hints);
  throwIfAborted(ctx.signal);
  return toExperienceView(info, { trend, hints, mallId: mallIdOf(ctx) });
}
