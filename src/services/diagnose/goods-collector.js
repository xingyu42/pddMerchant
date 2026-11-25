import { listGoods as defaultListGoods } from '../goods.js';
import {
  collectBoundedPages, DEFAULT_MAX_PAGES, DEFAULT_PAGE_DELAY_MS, DEFAULT_PAGE_SIZE,
} from '../pagination.js';

/**
 * Iterate `goods.list` pagination until all SKUs collected, cap reached, or rate-limited.
 *
 * Return shape: { goods, total, truncated, ratelimited }
 *   - goods:       Array — concatenated SKUs across pages
 *   - total:       number | null — reported total from last response (null if API didn't report)
 *   - truncated:   boolean — true only if the final page (maxPages-th) was still full AND total > cap
 *   - ratelimited: boolean — true if collection stopped due to E_RATE_LIMIT
 */
export async function collectAllGoods(page, ctx = {}, options = {}) {
  const listGoodsFn = options.listGoods ?? defaultListGoods;
  const { items: goods, total, truncated, ratelimited } = await collectBoundedPages({
    fetchPage: (pageNum, size) => listGoodsFn(page, { page: pageNum, size }, ctx),
    readItems: (result) => result?.goods,
    readTotal: (result) => result?.total,
    pageSize: options.pageSize ?? DEFAULT_PAGE_SIZE,
    maxPages: options.maxPages ?? DEFAULT_MAX_PAGES,
    delayMs: options.delayMs ?? DEFAULT_PAGE_DELAY_MS,
    signal: options.signal ?? ctx?.signal,
  });
  return { goods, total, truncated, ratelimited };
}
