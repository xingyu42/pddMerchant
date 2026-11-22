import { runEndpoint } from '../adapter/run-endpoint.js';
import { REVIEWS_KEYWORD_AGG, REVIEWS_TYPE_AGG, REVIEWS_LIST, REVIEWS_PAGE_SIZE, REVIEWS_VIEW_LIMIT,
  REVIEWS_GOODS_SCORES, GOODS_SCORES_PAGE_SIZE, GOODS_SCORES_MAX_PAGES } from '../adapter/endpoints/reviews.js';
import { throwIfAborted } from '../infra/abort.js';
import { mallIdOf } from './views/_shared.js';
import { toReviewsView, toGoodsReviewsView, REVIEWS_REPORT, GOODS_REVIEWS_REPORT,
  DEFAULT_GOODS_REVIEWS_FILTER } from './views/reviews.js';
import { runReport } from './operating-report.js';
import { rollingSecondsWindow } from './report-windows.js';

export { REVIEWS_REPORT, GOODS_REVIEWS_REPORT };

const NEGATIVE_STARS = Object.freeze(['1', '2', '3']);
const REVIEW_PAGING = Object.freeze({ pageSize: REVIEWS_PAGE_SIZE, maxPages: REVIEWS_VIEW_LIMIT / REVIEWS_PAGE_SIZE });
const GOODS_SCORE_PAGING = Object.freeze({ pageSize: GOODS_SCORES_PAGE_SIZE, maxPages: GOODS_SCORES_MAX_PAGES });

// 评价列表与商品评分列表共用的翻页采集：越过末页时上游总数回落为 0，总数取首页；
// 短页或取满即停，翻满 maxPages 仍有剩余时标记截断。
async function collectPages(ctx, spec, { pageSize, maxPages }, params = {}) {
  const items = [];
  let total = 0;
  for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
    throwIfAborted(ctx.signal);
    const result = await runEndpoint(ctx.page, spec, { ...params, page: pageNo, pageNo }, ctx);
    throwIfAborted(ctx.signal);
    if (pageNo === 1) total = result.totalRows;
    items.push(...result.data);
    if (result.data.length < pageSize || items.length >= total) break;
    if (pageNo === maxPages) return { items, total, truncated: true };
  }
  return { items, total, truncated: false };
}

function collectReviews(ctx, params) {
  return collectPages(ctx, REVIEWS_LIST, REVIEW_PAGING, params);
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
    // 商品评分固定为近 30 日，与 days 无关；它的成败不影响命令整体成败。
    const goodsScores = await report.optional('goods_scores_unavailable', async () =>
      collectPages(ctx, REVIEWS_GOODS_SCORES, GOODS_SCORE_PAGING));
    if (goodsScores?.truncated) report.hint('goods_scores_truncated');
    return toReviewsView({ keywords, types, reviews, goodsScores }, { days, hints: report.hints, mallId: mallIdOf(ctx) });
  });
}

// stars 为已校验的星级字符串数组，缺省为全部星级；goodsId 为正整数字符串，缺省为全店。
export async function getGoodsReviewsView(ctx, { days = GOODS_REVIEWS_REPORT.days.default, goodsId = null,
  stars = null, all = false } = {}) {
  const filter = all ? { mode: 'all', min_length: null } : DEFAULT_GOODS_REVIEWS_FILTER;
  return runReport(ctx, GOODS_REVIEWS_REPORT, { days, window: rollingSecondsWindow }, async (report) => {
    const reviews = await collectReviews(ctx, { ...report.window,
      ...(stars ? { descScore: stars } : {}), ...(goodsId ? { goodsId } : {}) });
    if (reviews.truncated) report.hint('list_truncated');
    return toGoodsReviewsView(reviews, { days, goodsId, stars, filter, hints: report.hints, mallId: mallIdOf(ctx) });
  });
}
