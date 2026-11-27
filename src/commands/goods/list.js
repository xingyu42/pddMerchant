import { withCommand } from '../_runner.js';
import { getGoodsListView } from '../../services/goods.js';

export const run = withCommand({
  name: 'goods.list',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const { page, size, status, withSkus, lowStock } = ctx.config;
    const data = await getGoodsListView(ctx.page, { page, size, status, withSkus, lowStock }, ctx);
    return { data, meta: { xhr_count: 1 } };
  },
});
