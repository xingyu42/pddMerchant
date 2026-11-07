import { runEndpoint } from '../adapter/run-endpoint.js';
import { REVIEWS_KEYWORD_AGG, REVIEWS_TYPE_AGG, REVIEWS_LIST } from '../adapter/endpoints/reviews.js';
import { throwIfAborted } from '../infra/abort.js';
import { mallIdOf } from './views/_shared.js';
import { toReviewsView, REVIEWS_REPORT } from './views/reviews.js';
import { runReport } from './operating-report.js';
import { rollingSecondsWindow } from './report-windows.js';

export { REVIEWS_REPORT };

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

export async function getReviewsView(ctx, { days = REVIEWS_REPORT.days.default } = {}) {
  return runReport(ctx, REVIEWS_REPORT, { days, window: rollingSecondsWindow }, async (report) => {
    const params = { ...report.window, rangeType: REVIEWS_REPORT.days.choices[days] };
    let lastError = null;
    const unavailable = (error) => { lastError = error; return null; };
    const keywords = await report.optional('keywords_unavailable', async () =>
      runEndpoint(ctx.page, REVIEWS_KEYWORD_AGG, params, ctx), unavailable);
    const types = await report.optional('types_unavailable', async () =>
      runEndpoint(ctx.page, REVIEWS_TYPE_AGG, params, ctx), unavailable);
    const reviews = await report.optional('reviews_unavailable', async () => collectReviews(ctx, params), unavailable);
    if (keywords === null && types === null && reviews === null) throw lastError;
    if (reviews?.truncated) report.hint('list_truncated');
    return toReviewsView({ keywords, types, reviews }, { days, hints: report.hints, mallId: mallIdOf(ctx) });
  });
}
