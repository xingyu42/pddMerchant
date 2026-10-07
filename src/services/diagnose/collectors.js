import { listOrders, getOrderStats, computeOrderStats } from '../orders.js';
import { getPromoReport } from '../promo.js';
import { getLogger } from '../../infra/logger.js';
import { collectAllGoods } from './goods-collector.js';
import { collectOrdersForStaleAnalysis } from './orders-collector.js';

function collectorLog(ctx) {
  return ctx?.log ?? getLogger();
}

export async function collectOrdersInput(page, ctx, { since, until, windowDays = 7 } = {}) {
  const hasContext = typeof page?.context === 'function';
  const statsPage = hasContext ? await page.context().newPage() : page;
  const nowSec = until ?? Math.floor(Date.now() / 1000);
  const sinceSec = since ?? (nowSec - windowDays * 86400);
  const log = collectorLog(ctx);
  try {
    const [statsResult, listResult] = await Promise.allSettled([
      getOrderStats(statsPage, ctx),
      listOrders(page, { page: 1, size: 50, since: sinceSec, until: nowSec }, ctx),
    ]);
    if (statsResult.status === 'rejected') {
      log.debug({ err: statsResult.reason?.message }, 'diagnose: order stats collection failed');
    }
    if (listResult.status === 'rejected') {
      log.debug({ err: listResult.reason?.message }, 'diagnose: order list collection failed');
    }
    const stats = statsResult.status === 'fulfilled' ? statsResult.value : null;
    const listStats = listResult.status === 'fulfilled'
      ? computeOrderStats(listResult.value?.orders ?? [])
      : null;
    if (stats == null && listStats == null) {
      const firstErr = statsResult.reason ?? listResult.reason;
      if (firstErr) throw firstErr;
      return undefined;
    }
    return { stats, listStats, windowDays };
  } finally {
    if (hasContext && statsPage !== page) await statsPage.close().catch(() => {});
  }
}

export async function collectGoodsInput(page, ctx) {
  const log = collectorLog(ctx);
  const collected = await collectAllGoods(page, ctx);
  const goods = collected.goods ?? [];
  const goodsScanTruncated = collected.truncated;
  const goodsScanRateLimited = collected.ratelimited;
  const reported = Number(collected.total);
  const goodsTotal = Number.isFinite(reported) && reported > 0 ? reported : goods.length;
  if (goods.length === 0 && !goodsScanRateLimited) return undefined;

  let orders30d = null;
  let truncated = false;
  let ratelimited = false;
  try {
    const stale = await collectOrdersForStaleAnalysis(page, ctx);
    orders30d = stale.orders;
    truncated = stale.truncated;
    ratelimited = stale.ratelimited;
  } catch (err) {
    // Missing order enrichment remains unknown, not zero sales.
    log.debug({ err: err?.message }, 'diagnose: stale-order enrichment failed');
  }
  return { goods, goodsTotal, goodsScanTruncated, goodsScanRateLimited, orders30d, truncated, ratelimited };
}

export async function collectPromoInput(page, ctx, { since, until } = {}) {
  const params = {};
  if (since) params.since = since instanceof Date ? since : new Date(since * 1000);
  if (until) params.until = until instanceof Date ? until : new Date(until * 1000);
  const report = await getPromoReport(page, params, ctx);
  return { totals: report?.totals ?? null, warnings: report?.unitWarnings ?? [] };
}
