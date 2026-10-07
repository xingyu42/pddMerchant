import { withCommand } from '../_runner.js';
import { getGoodsListView } from '../../services/goods.js';

export const run = withCommand({
  name: 'goods.list',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const { page: pageNum, size, status } = ctx.config;
    const data = await getGoodsListView(ctx.page, { page: pageNum, size, status }, ctx);
    return { data, meta: { xhr_count: 1 } };
  },
});

export default run;
