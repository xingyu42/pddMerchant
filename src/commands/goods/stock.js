import { withCommand } from '../_runner.js';
import { getGoodsStockView, DEFAULT_LOW_STOCK_THRESHOLD } from '../../services/goods.js';

export const run = withCommand({
  name: 'goods.stock',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const { page: pageNum, size, threshold = DEFAULT_LOW_STOCK_THRESHOLD } = ctx.config;
    const data = await getGoodsStockView(ctx.page, { page: pageNum, size, threshold }, ctx);
    return { data, meta: { xhr_count: 1 } };
  },
});

export default run;
