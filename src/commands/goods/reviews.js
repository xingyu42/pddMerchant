import { withCommand } from '../_runner.js';
import { getGoodsReviewsView } from '../../services/reviews.js';

export const run = withCommand({
  name: 'goods.reviews', needsAuth: true, needsMall: 'switch',
  async run(ctx) {
    return getGoodsReviewsView(ctx, {
      days: ctx.config?.days,
      goodsId: ctx.config?.goodsId,
      stars: ctx.config?.stars,
      all: Boolean(ctx.config?.all),
      minLength: ctx.config?.minLength,
    });
  },
});
