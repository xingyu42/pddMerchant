import { listGoods as defaultListGoods } from '../goods.js';
import { PddCliError } from '../../infra/errors.js';

export const GOODS_SCAN_PAGE_SIZE = 50;
export const GOODS_SCAN_MAX_PAGES = 10;
const PAGE_DELAY_MS = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Iterate `goods.list` pagination until all SKUs collected, cap reached, or rate-limited.
 * Mirror of `orders-collector.js:collectOrdersForStaleAnalysis` — same invariants (cap, sleep, 429 handling).
 *
 * Return shape: { goods, total, truncated, ratelimited }
 *   - goods:       Array — concatenated SKUs across pages
 *   - total:       number | null — reported total from last response (null if API didn't report)
 *   - truncated:   boolean — true only if the final page (maxPages-th) was still full AND total > cap
 *   - ratelimited: boolean — true if collection stopped due to E_RATE_LIMIT
 */
export async function collectAllGoods(page, ctx = {}, options = {}) {
  const pageSize = options.pageSize ?? GOODS_SCAN_PAGE_SIZE;
  const maxPages = options.maxPages ?? GOODS_SCAN_MAX_PAGES;
  const delayMs = options.delayMs ?? PAGE_DELAY_MS;
  const listGoodsFn = options.listGoods ?? defaultListGoods;

  const goods = [];
  let reportedTotal = null;
  let truncated = false;
  let ratelimited = false;

  for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
    let result;
    try {
      result = await listGoodsFn(page, { page: pageNum, size: pageSize }, ctx);
    } catch (err) {
      if (err instanceof PddCliError && err.code === 'E_RATE_LIMIT') {
        ratelimited = true;
        break;
      }
      throw err;
    }

    const batch = Array.isArray(result?.goods) ? result.goods : [];
    goods.push(...batch);

    const reported = Number(result?.total);
    if (Number.isFinite(reported) && reported > 0) reportedTotal = reported;

    if (reportedTotal != null && goods.length >= reportedTotal) break;
    if (batch.length === 0) break;
    if (batch.length < pageSize) break;

    if (pageNum === maxPages) {
      if (reportedTotal == null || reportedTotal > goods.length) truncated = true;
      break;
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  return { goods, total: reportedTotal, truncated, ratelimited };
}
