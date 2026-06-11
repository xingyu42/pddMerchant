import { listOrders, getOrderStats, computeOrderStats } from '../orders.js';
import { getPromoReport } from '../promo.js';
import { collectAllGoods } from './goods-collector.js';
import { collectOrdersForStaleAnalysis } from './orders-collector.js';

export async function collectOrdersInput(page, ctx, { since, until, windowDays = 7 } = {}) {
  const hasContext = typeof page?.context === 'function';
  const statsPage = hasContext ? await page.context().newPage() : page;
  const nowSec = until ?? Math.floor(Date.now() / 1000);
  const sinceSec = since ?? (nowSec - windowDays * 86400);
  try {
    const [statsResult, listResult] = await Promise.allSettled([
      getOrderStats(statsPage, ctx),
      listOrders(page, { page: 1, size: 50, since: sinceSec, until: nowSec }, ctx),
    ]);
    const stats = statsResult.status === 'fulfilled' ? statsResult.value : null;
    const listStats = listResult.status === 'fulfilled'
      ? computeOrderStats(listResult.value?.orders ?? [])
      : null;
    if (stats == null && listStats == null) return undefined;
    return { stats, listStats, windowDays };
  } finally {
    if (hasContext && statsPage !== page) await statsPage.close().catch(() => {});
  }
}

export async function collectGoodsInput(page, ctx) {
  let goods;
  let goodsTotal;
  let goodsScanTruncated = false;
  let goodsScanRateLimited = false;
  try {
    const collected = await collectAllGoods(page, ctx);
    goods = collected.goods ?? [];
    goodsScanTruncated = collected.truncated;
    goodsScanRateLimited = collected.ratelimited;
    const reported = Number(collected.total);
    goodsTotal = Number.isFinite(reported) && reported > 0 ? reported : goods.length;
  } catch {
    return undefined;
  }
  if (goods.length === 0 && !goodsScanRateLimited) return undefined;
  let orders30d = null;
  let truncated = false;
  let ratelimited = false;
  try {
    const collected = await collectOrdersForStaleAnalysis(page, ctx);
    orders30d = collected.orders;
    truncated = collected.truncated;
    ratelimited = collected.ratelimited;
  } catch {
    // stale data missing — scoreInventoryHealth handles missing branch
  }
  return { goods, goodsTotal, goodsScanTruncated, goodsScanRateLimited, orders30d, truncated, ratelimited };
}

export async function collectPromoInput(page, ctx, { since, until } = {}) {
  try {
    const params = {};
    if (since) params.since = since instanceof Date ? since : new Date(since * 1000);
    if (until) params.until = until instanceof Date ? until : new Date(until * 1000);
    const report = await getPromoReport(page, params, ctx);
    return { totals: report?.totals ?? null };
  } catch {
    return undefined;
  }
}
