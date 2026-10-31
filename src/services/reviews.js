import { runEndpoint } from '../adapter/run-endpoint.js';
import { REVIEWS_KEYWORD_AGG, REVIEWS_TYPE_AGG, REVIEWS_LIST } from '../adapter/endpoints/reviews.js';
import { ExitCodes, PddCliError } from '../infra/errors.js';
import { throwIfAborted } from '../infra/abort.js';
import { mallIdOf } from './views/_shared.js';
import { toReviewsView } from './views/reviews.js';

const RANGE_TYPES = new Map([[30, 1], [60, 5], [90, 4], [180, 3]]);

function timeWindow(days) {
  if (!RANGE_TYPES.has(days)) {
    throw new PddCliError({ code: 'E_USAGE', message: '--days 需为 30、60、90 或 180', exitCode: ExitCodes.USAGE });
  }
  const endTime = Math.floor(Date.now() / 1000);
  return { startTime: endTime - days * 86400, endTime, rangeType: RANGE_TYPES.get(days) };
}

async function collectReviews(ctx, params) {
  const items = [];
  let total = 0;
  for (let pageNo = 1; pageNo <= 30; pageNo += 1) {
    throwIfAborted(ctx.signal);
    const result = await runEndpoint(ctx.page, REVIEWS_LIST, { ...params, page: pageNo, pageNo }, ctx);
    throwIfAborted(ctx.signal);
    total = result.totalRows;
    items.push(...result.data);
    if (pageNo === 30 && result.data.length === 10) return { items, total, truncated: true };
    if (result.data.length < 10 || items.length >= total) break;
  }
  return { items, total, truncated: false };
}

async function optionalSource(ctx, collect, hint, state) {
  try {
    throwIfAborted(ctx.signal);
    const result = await collect();
    throwIfAborted(ctx.signal);
    return result;
  } catch (error) {
    throwIfAborted(ctx.signal);
    if (error?.code === 'E_TIMEOUT' || error?.name === 'AbortError') throw error;
    if (!(error instanceof PddCliError)) throw error;
    state.lastError = error;
    state.hints.push(hint);
    return null;
  }
}

export async function getReviewsView(ctx, { days = 30 } = {}) {
  const params = timeWindow(days);
  const state = { hints: [], lastError: null };
  const keywords = await optionalSource(ctx, async () =>
    runEndpoint(ctx.page, REVIEWS_KEYWORD_AGG, params, ctx), 'keywords_unavailable', state);
  const types = await optionalSource(ctx, async () =>
    runEndpoint(ctx.page, REVIEWS_TYPE_AGG, params, ctx), 'types_unavailable', state);
  const reviews = await optionalSource(ctx, async () => collectReviews(ctx, params), 'reviews_unavailable', state);
  if (keywords === null && types === null && reviews === null) throw state.lastError;
  if (reviews?.truncated) state.hints.push('list_truncated');
  throwIfAborted(ctx.signal);
  return toReviewsView({ keywords, types, reviews }, { days, hints: state.hints, mallId: mallIdOf(ctx) });
}
