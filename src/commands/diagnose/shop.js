import { withCommand } from '../_runner.js';
import { renderShopDashboard } from './_render.js';
import { diagnoseShop } from '../../services/diagnose/index.js';
import { collectOrdersInput, collectGoodsInput, collectPromoInput } from '../../services/diagnose/collectors.js';
import { resolveCompareWindows, compareShopDiagnosis } from '../../services/diagnose/trend-compare.js';

async function collectDiagnosis(page, ctx, { since, until, windowDays } = {}) {
  const hasContext = typeof page?.context === 'function';
  const goodsPage = hasContext ? await page.context().newPage() : page;
  const promoPage = hasContext ? await page.context().newPage() : page;
  try {
    const [orders, goods, promo] = await Promise.all([
      collectOrdersInput(page, ctx, { since, until, windowDays }),
      collectGoodsInput(goodsPage, ctx),
      collectPromoInput(promoPage, ctx, { since, until }),
    ]);
    return diagnoseShop({
      orders,
      goods,
      promo,
      funnel: orders?.listStats ? { orderStats: orders.listStats, windowDays: orders.windowDays ?? windowDays ?? 7 } : undefined,
    });
  } finally {
    if (hasContext) {
      await goodsPage.close().catch(() => {});
      await promoPage.close().catch(() => {});
    }
  }
}

export const run = withCommand({
  name: 'diagnose.shop',
  needsAuth: true,
  needsMall: 'switch',
  render: renderShopDashboard,
  async run(ctx) {
    const page = ctx.page;
    const compare = ctx.config.compare ?? false;
    const days = ctx.config.days ?? 7;

    if (!compare) {
      return collectDiagnosis(page, ctx, { windowDays: days });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const windows = resolveCompareWindows({ nowSec, days });

    const [currentResult, previousResult] = await Promise.allSettled([
      collectDiagnosis(page, ctx, {
        since: windows.current.since,
        until: windows.current.until,
        windowDays: days,
      }),
      collectDiagnosis(page, ctx, {
        since: windows.previous.since,
        until: windows.previous.until,
        windowDays: days,
      }),
    ]);

    const current = currentResult.status === 'fulfilled' ? currentResult.value : null;
    const previous = previousResult.status === 'fulfilled' ? previousResult.value : null;

    if (!current) return { score: null, status: 'partial', dimensions: {}, issues: [], hints: [] };

    const comparison = compareShopDiagnosis({ current, previous });

    return {
      ...current,
      compare: {
        current_window: windows.current,
        previous_window: windows.previous,
        status: previous ? 'full' : 'partial',
        ...comparison,
      },
    };
  },
});

export default run;
