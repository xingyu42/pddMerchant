import { withCommand } from '../../infra/command-runner.js';
import { generateActionPlan } from '../../services/action-plan.js';
import { diagnoseShop } from '../../services/diagnose/index.js';
import { analyzePromoRoi } from '../../services/promo-roi.js';
import { segmentGoods } from '../../services/goods-segmentation.js';
import { resolveCompareWindows, compareShopDiagnosis } from '../../services/diagnose/trend-compare.js';
import { collectOrdersInput, collectGoodsInput, collectPromoInput } from '../diagnose/shop.js';
import { collectOrdersForStaleAnalysis } from '../../services/diagnose/orders-collector.js';
import { getPromoReport } from '../../services/promo.js';

export const run = withCommand({
  name: 'action.plan',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const {
      days = 7,
      compare: doCompare = false,
      limit = 10,
      breakEven = 1.0,
      promo: usePromo = true,
      segment: useSegment = true,
    } = ctx.config;
    const page = ctx.page;

    const hasContext = typeof page?.context === 'function';
    const goodsPage = hasContext ? await page.context().newPage() : page;
    const promoPage = hasContext ? await page.context().newPage() : page;

    try {
      const [orders, goodsInput, promoInput] = await Promise.all([
        collectOrdersInput(page, ctx, { windowDays: days }),
        collectGoodsInput(goodsPage, ctx),
        collectPromoInput(promoPage, ctx),
      ]);

      const diagnosis = diagnoseShop({
        orders,
        goods: goodsInput,
        promo: promoInput,
        funnel: orders?.listStats ? { orderStats: orders.listStats, windowDays: days } : undefined,
      });

      let promoRoi = null;
      if (usePromo && promoInput?.totals) {
        try {
          const report = await getPromoReport(page, {}, ctx);
          if (report?.entities?.length > 0) {
            promoRoi = analyzePromoRoi(
              { entities: report.entities, totals: report.totals ?? {} },
              { by: 'plan', breakEvenRoi: breakEven },
            );
          }
        } catch { /* optional */ }
      }

      let segmentation = null;
      if (useSegment && goodsInput) {
        try {
          const ordersResult = await collectOrdersForStaleAnalysis(page, ctx, { scanDays: 30 });
          segmentation = segmentGoods(
            {
              goods: goodsInput.goods ?? [],
              orders30d: ordersResult.orders,
              promoRoi: promoRoi ? { rows: promoRoi.rows.filter((r) => r.goods_id) } : null,
              truncated: ordersResult.truncated,
              ratelimited: ordersResult.ratelimited,
            },
            { windowDays: 30, breakEvenRoi: breakEven },
          );
        } catch { /* optional */ }
      }

      let comparison = null;
      if (doCompare) {
        try {
          const nowSec = Math.floor(Date.now() / 1000);
          const windows = resolveCompareWindows({ nowSec, days });
          const [prevOrders, prevPromo] = await Promise.allSettled([
            collectOrdersInput(page, ctx, {
              since: windows.previous.since,
              until: windows.previous.until,
              windowDays: days,
            }),
            collectPromoInput(promoPage, ctx, {
              since: windows.previous.since,
              until: windows.previous.until,
            }),
          ]);
          const prevDiag = diagnoseShop({
            orders: prevOrders.status === 'fulfilled' ? prevOrders.value : undefined,
            goods: goodsInput,
            promo: prevPromo.status === 'fulfilled' ? prevPromo.value : undefined,
            funnel: prevOrders.status === 'fulfilled' && prevOrders.value?.listStats
              ? { orderStats: prevOrders.value.listStats, windowDays: days }
              : undefined,
          });
          comparison = compareShopDiagnosis({ current: diagnosis, previous: prevDiag });
        } catch { /* comparison optional */ }
      }

      const result = generateActionPlan(
        { diagnosis, promoRoi, segmentation, compare: comparison },
        { limit },
      );

      const { warnings: resultWarnings, ...data } = result;
      return { data, warnings: resultWarnings };
    } finally {
      if (hasContext) {
        await goodsPage.close().catch(() => {});
        await promoPage.close().catch(() => {});
      }
    }
  },
});

export default run;
