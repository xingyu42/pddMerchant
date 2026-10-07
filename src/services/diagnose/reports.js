// diagnose.* 命令级结果（输出契约 v2）：采集 → summarize（内部代码）→ 视图（标签 + headline）。
import { getLogger } from '../../infra/logger.js';
import { computeOrderStats } from '../orders.js';
import { mallIdOf } from '../views/_shared.js';
import { toDimensionView, toShopView } from '../views/diagnose.js';
import { collectGoodsInput, collectOrdersInput, collectPromoInput } from './collectors.js';
import { diagnoseShop, summarizeFunnel, summarizeInventory, summarizeOrders, summarizePromo } from './index.js';
import { collectOrdersForStaleAnalysis, STALE_PAGE_SIZE } from './orders-collector.js';
import { compareShopDiagnosis, resolveCompareWindows } from './trend-compare.js';

const FUNNEL_DEFAULT_DAYS = 30;
const FUNNEL_PAGES_PER_WEEK = 3;

function dimensionResult(name, result, ctx, warnings = []) {
  return { data: { ...toDimensionView(name, result), mall_id: mallIdOf(ctx) }, warnings };
}

export async function getOrdersDiagnosis(ctx) {
  const input = await collectOrdersInput(ctx.page, { ...ctx, mallId: mallIdOf(ctx) });
  return dimensionResult('orders', summarizeOrders(input || {}), ctx);
}

export async function getInventoryDiagnosis(ctx) {
  const input = await collectGoodsInput(ctx.page, { ...ctx, mallId: mallIdOf(ctx) });
  return dimensionResult('inventory', summarizeInventory(input || {}), ctx);
}

export async function getPromoDiagnosis(ctx) {
  const input = await collectPromoInput(ctx.page, { ...ctx, mallId: mallIdOf(ctx) });
  return dimensionResult('promo', summarizePromo(input), ctx, input?.warnings ?? []);
}

export async function getFunnelDiagnosis(ctx, { days } = {}) {
  const windowDays = typeof days === 'number' && days > 0 ? days : FUNNEL_DEFAULT_DAYS;
  const maxPages = Math.max(10, Math.ceil(windowDays / 7) * FUNNEL_PAGES_PER_WEEK);
  const { orders, truncated, ratelimited } = await collectOrdersForStaleAnalysis(
    ctx.page,
    { ...ctx, mallId: mallIdOf(ctx) },
    { scanDays: windowDays, maxPages, pageSize: STALE_PAGE_SIZE },
  );
  const result = summarizeFunnel({ orderStats: computeOrderStats(orders), windowDays });
  if (truncated || ratelimited) result.status = 'partial';
  if (truncated) result.hints.push(`订单量超出采集上限（${maxPages * STALE_PAGE_SIZE} 条），统计基于部分数据`);
  if (ratelimited) result.hints.push('订单采集因限流中断，统计基于部分数据');
  return dimensionResult('funnel', result, ctx);
}

async function settleDimension(label, promise, log) {
  try {
    return await promise;
  } catch (err) {
    log.debug({ err: err?.message, dimension: label }, 'diagnose.shop: dimension collection failed');
    return undefined;
  }
}

// 单个时间窗的全维度诊断；同时返回推广金额单位警告
async function collectDiagnosis(ctx, { since, until, windowDays } = {}) {
  const page = ctx.page;
  const hasContext = typeof page?.context === 'function';
  const goodsPage = hasContext ? await page.context().newPage() : page;
  const promoPage = hasContext ? await page.context().newPage() : page;
  const log = ctx.log ?? getLogger();
  try {
    const [orders, goods, promo] = await Promise.all([
      settleDimension('orders', collectOrdersInput(page, ctx, { since, until, windowDays }), log),
      settleDimension('goods', collectGoodsInput(goodsPage, ctx), log),
      settleDimension('promo', collectPromoInput(promoPage, ctx, { since, until }), log),
    ]);
    const result = diagnoseShop({
      orders,
      goods,
      promo,
      funnel: orders?.listStats ? { orderStats: orders.listStats, windowDays: orders.windowDays ?? windowDays ?? 7 } : undefined,
    });
    return { result, warnings: promo?.warnings ?? [] };
  } finally {
    if (hasContext) {
      await goodsPage.close().catch(() => {});
      await promoPage.close().catch(() => {});
    }
  }
}

async function collectComparison(ctx, days) {
  const windows = resolveCompareWindows({ nowSec: Math.floor(Date.now() / 1000), days });
  const [currentResult, previousResult] = await Promise.allSettled([
    collectDiagnosis(ctx, { since: windows.current.since, until: windows.current.until, windowDays: days }),
    collectDiagnosis(ctx, { since: windows.previous.since, until: windows.previous.until, windowDays: days }),
  ]);
  const current = currentResult.status === 'fulfilled' ? currentResult.value : null;
  const previous = previousResult.status === 'fulfilled' ? previousResult.value : null;
  if (!current) return { result: diagnoseShop(), warnings: [] };
  const comparison = compareShopDiagnosis({ current: current.result, previous: previous?.result });
  const compare = {
    current_window: windows.current,
    previous_window: windows.previous,
    status: current.result.status === 'full' && previous?.result.status === 'full' ? 'full' : 'partial',
    ...comparison,
  };
  return { result: { ...current.result, compare }, warnings: [...current.warnings, ...(previous?.warnings ?? [])] };
}

export async function getShopDiagnosis(ctx, { compare = false, days = 7 } = {}) {
  const { result, warnings } = compare
    ? await collectComparison(ctx, days)
    : await collectDiagnosis(ctx, { windowDays: days });
  return { data: toShopView(result, { mallId: mallIdOf(ctx) }), warnings: [...new Set(warnings)] };
}
