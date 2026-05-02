import { withCommand } from '../../infra/command-runner.js';
import { segmentGoods } from '../../services/goods-segmentation.js';
import { collectAllGoods } from '../../services/diagnose/goods-collector.js';
import { collectOrdersForStaleAnalysis } from '../../services/diagnose/orders-collector.js';
import { analyzePromoRoi } from '../../services/promo-roi.js';
import { getPromoReport } from '../../services/promo.js';

export const run = withCommand({
  name: 'goods.segment',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const {
      days = 30,
      size = 50,
      maxPages = 10,
      breakEven = 1.0,
      promo: usePromo = true,
    } = ctx.config;
    const page = ctx.page;

    const hasContext = typeof page?.context === 'function';
    const ordersPage = hasContext ? await page.context().newPage() : page;
    const promoPage = hasContext ? await page.context().newPage() : page;

    try {
      const [goodsResult, ordersResult] = await Promise.all([
        collectAllGoods(page, ctx, { pageSize: size, maxPages }),
        collectOrdersForStaleAnalysis(ordersPage, ctx, { scanDays: days }),
      ]);

      let promoRoi = null;
      if (usePromo) {
        try {
          const report = await getPromoReport(promoPage, {}, ctx);
          if (report?.entities?.length > 0) {
            promoRoi = analyzePromoRoi(
              { entities: report.entities, totals: report.totals ?? {} },
              { by: 'sku', breakEvenRoi: breakEven },
            );
          }
        } catch { /* promo data optional */ }
      }

      const result = segmentGoods(
        {
          goods: goodsResult.goods,
          orders30d: ordersResult.orders,
          promoRoi,
          truncated: ordersResult.truncated,
          ratelimited: ordersResult.ratelimited,
        },
        { windowDays: days, breakEvenRoi: breakEven },
      );

      const { warnings: resultWarnings, ...data } = result;
      return { data, warnings: resultWarnings };
    } finally {
      if (hasContext) {
        await ordersPage.close().catch(() => {});
        await promoPage.close().catch(() => {});
      }
    }
  },
});

export default run;
