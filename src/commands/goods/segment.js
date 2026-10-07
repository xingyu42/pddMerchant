import { withCommand } from '../_runner.js';
import { getGoodsSegmentView } from '../../services/goods-segmentation.js';

export const run = withCommand({
  name: 'goods.segment',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const { days = 30, size = 50, maxPages = 10, promo: usePromo = true } = ctx.config;
    return getGoodsSegmentView(ctx, { days, size, maxPages, usePromo });
  },
});

export default run;
