import { withCommand } from '../_runner.js';
import { getGoodsProfitView } from '../../services/goods-profit.js';

export const run = withCommand({
  name: 'goods.profit', needsAuth: true, needsMall: 'switch',
  async run(ctx) {
    return getGoodsProfitView(ctx, { days: ctx.config.days, goodsId: ctx.config.goodsId });
  },
});
