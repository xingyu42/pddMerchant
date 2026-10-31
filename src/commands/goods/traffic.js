import { withCommand } from '../_runner.js';
import { getGoodsTrafficView } from '../../services/goods-traffic.js';

export const run = withCommand({
  name: 'goods.traffic', needsAuth: true, needsMall: 'switch',
  async run(ctx) { return getGoodsTrafficView(ctx, { days: ctx.config?.days, goodsId: ctx.config?.goodsId }); },
});

export default run;
