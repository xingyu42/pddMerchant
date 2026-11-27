// diagnose.shop 命令级结果（输出契约 v2）：采集 → summarize（内部代码）→ 视图（标签 + headline）。
import { getLogger } from '../../infra/logger.js';
import { mallIdOf } from '../views/_shared.js';
import { toShopView } from '../views/diagnose.js';
import { collectGoodsInput, collectOrdersInput, collectPromoInput } from './collectors.js';
import { diagnoseShop } from './index.js';
import { compareShopDiagnosis, resolveCompareWindows } from './trend-compare.js';
import { withEndpointPages } from '../../adapter/endpoint-pages.js';

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
  const log = ctx.log ?? getLogger();
  return withEndpointPages(page, 2, async ([goodsPage, promoPage]) => {
    const [orders, goods, promo] = await Promise.all([
      settleDimension('orders', collectOrdersInput(page, ctx, { since, until, windowDays }), log),
      settleDimension('goods', collectGoodsInput(goodsPage, ctx), log),
      settleDimension('promo', collectPromoInput(promoPage, ctx, { since, until }), log),
    ]);
    const result = diagnoseShop({
      orders,
      goods,
      promo,
      after_sales: orders?.listStats ? { orderStats: orders.listStats, windowDays: orders.windowDays ?? windowDays ?? 7 } : undefined,
    });
    return { result, warnings: promo?.warnings ?? [] };
  });
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
