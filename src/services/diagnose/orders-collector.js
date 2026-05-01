import { listOrders as defaultListOrders } from '../orders.js';
import { PddCliError } from '../../infra/errors.js';

export const STALE_SCAN_DAYS = 30;
export const STALE_PAGE_SIZE = 50;
export const STALE_MAX_PAGES = 10;
const PAGE_DELAY_MS = 200;
const DAY_SECONDS = 86400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function collectOrdersForStaleAnalysis(page, ctx = {}, options = {}) {
  const pageSize = options.pageSize ?? STALE_PAGE_SIZE;
  const maxPages = options.maxPages ?? STALE_MAX_PAGES;
  const delayMs = options.delayMs ?? PAGE_DELAY_MS;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const listOrdersFn = options.listOrders ?? defaultListOrders;
  const scanDays = options.scanDays ?? STALE_SCAN_DAYS;
  const since = options.since ?? (now - scanDays * DAY_SECONDS);

  const orders = [];
  let truncated = false;
  let ratelimited = false;

  for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
    let result;
    try {
      result = await listOrdersFn(page, {
        page: pageNum,
        size: pageSize,
        since,
        until: now,
      }, ctx);
    } catch (err) {
      if (err instanceof PddCliError && err.code === 'E_RATE_LIMIT') {
        ratelimited = true;
        break;
      }
      throw err;
    }
    const batch = Array.isArray(result?.orders) ? result.orders : [];
    orders.push(...batch);
    if (batch.length < pageSize) break;
    if (pageNum === maxPages) {
      truncated = true;
      break;
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  return { orders, truncated, ratelimited };
}
