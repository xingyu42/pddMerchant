import { PddCliError } from '../infra/errors.js';
import { abortableSleep, throwIfAborted } from '../infra/abort.js';

export const DEFAULT_PAGE_SIZE = 50;
export const DEFAULT_MAX_PAGES = 10;
export const DEFAULT_PAGE_DELAY_MS = 200;

function readPositiveTotal(readTotal, result, current) {
  if (!readTotal) return current;
  const rawTotal = readTotal(result);
  if (rawTotal === null || rawTotal === undefined || rawTotal === '') return current;
  const reported = Number(rawTotal);
  return Number.isFinite(reported) && reported > 0 ? reported : current;
}

/**
 * 可中止的有界分页遍历原语：统一处理页数上限、页间可取消休眠、空页/短页截止、总数校验与限流降级。
 */
export async function collectBoundedPages({
  fetchPage,
  readItems,
  readTotal = null,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
  delayMs = DEFAULT_PAGE_DELAY_MS,
  signal,
}) {
  throwIfAborted(signal);
  const items = [];
  let reportedTotal = null;
  let truncated = false;
  let ratelimited = false;

  for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
    throwIfAborted(signal);
    let result;
    try {
      result = await fetchPage(pageNum, pageSize);
    } catch (err) {
      throwIfAborted(signal);
      if (err instanceof PddCliError && err.code === 'E_RATE_LIMIT') {
        ratelimited = true;
        break;
      }
      throw err;
    }
    throwIfAborted(signal);

    const rawBatch = readItems(result);
    const batch = Array.isArray(rawBatch) ? rawBatch : [];
    items.push(...batch);
    reportedTotal = readPositiveTotal(readTotal, result, reportedTotal);

    if (reportedTotal != null && items.length >= reportedTotal) break;
    if (batch.length === 0 || batch.length < pageSize) break;
    if (pageNum === maxPages) {
      if (reportedTotal == null || reportedTotal > items.length) truncated = true;
      break;
    }
    if (delayMs > 0) await abortableSleep(delayMs, signal);
  }

  return { items, total: reportedTotal, truncated, ratelimited };
}
