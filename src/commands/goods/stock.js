import { withCommand } from '../../infra/command-runner.js';
import { getGoodsStock, DEFAULT_LOW_STOCK_THRESHOLD } from '../../services/goods.js';

export const run = withCommand({
  name: 'goods.stock',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const { page: pageNum, size, threshold = DEFAULT_LOW_STOCK_THRESHOLD } = ctx.config;
    const mallId = ctx.mallCtx?.activeId ?? null;
    const result = await getGoodsStock(ctx.page, { page: pageNum, size, threshold }, ctx);
    return {
      data: result.low_stock,
      meta: {
        xhr_count: 1,
        total: result.total,
        threshold: result.threshold,
        low_stock_count: result.low_stock_count,
        mall: mallId,
      },
    };
  },
});

export default run;
