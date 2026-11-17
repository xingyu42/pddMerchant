import { runEndpoint } from '../adapter/run-endpoint.js';
import { REVIEWS_KEYWORD_AGG, REVIEWS_TYPE_AGG, REVIEWS_LIST, REVIEWS_PAGE_SIZE, REVIEWS_VIEW_LIMIT }
  from '../adapter/endpoints/reviews.js';
import { throwIfAborted } from '../infra/abort.js';
import { mallIdOf } from './views/_shared.js';
import { toReviewsView, toGoodsReviewsView, REVIEWS_REPORT, GOODS_REVIEWS_REPORT } from './views/reviews.js';
import { runReport } from './operating-report.js';
import { rollingSecondsWindow } from './report-windows.js';

export { REVIEWS_REPORT, GOODS_REVIEWS_REPORT };

const NEGATIVE_STARS = Object.freeze(['1', '2', '3']);
const MAX_PAGES = REVIEWS_VIEW_LIMIT / REVIEWS_PAGE_SIZE;

// 越过末页时上游 totalRows 回落为 0，总数取首页。
async function collectReviews(ctx, params) {
  const items = [];
  let total = 0;
  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
    throwIfAborted(ctx.signal);
    const result = await runEndpoint(ctx.page, REVIEWS_LIST, { ...params, page: pageNo, pageNo }, ctx);
    throwIfAborted(ctx.signal);
    if (pageNo === 1) total = result.totalRows;
    items.push(...result.data);
    if (result.data.length < REVIEWS_PAGE_SIZE || items.length >= total) break;
    if (pageNo === MAX_PAGES) return { items, total, truncated: true };
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
    const reviews = await report.optional('reviews_unavailable', async () =>
      collectReviews(ctx, { ...params, descScore: NEGATIVE_STARS }), unavailable);
    if (keywords === null && types === null && reviews === null) throw lastError;
    if (reviews?.truncated) report.hint('list_truncated');
    return toReviewsView({ keywords, types, reviews }, { days, hints: report.hints, mallId: mallIdOf(ctx) });
  });
}

// stars 为已校验的星级字符串数组，缺省为全部星级；goodsId 为正整数字符串，缺省为全店。
export async function getGoodsReviewsView(ctx, { days = GOODS_REVIEWS_REPORT.days.default, goodsId = null,
  stars = null } = {}) {
  return runReport(ctx, GOODS_REVIEWS_REPORT, { days, window: rollingSecondsWindow }, async (report) => {
    const reviews = await collectReviews(ctx, { ...report.window,
      ...(stars ? { descScore: stars } : {}), ...(goodsId ? { goodsId } : {}) });
    if (reviews.truncated) report.hint('list_truncated');
    return toGoodsReviewsView(reviews, { days, goodsId, stars, hints: report.hints, mallId: mallIdOf(ctx) });
  });
}
