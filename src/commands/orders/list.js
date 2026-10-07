import { withCommand } from '../_runner.js';
import { getOrderListView } from '../../services/orders.js';

export const run = withCommand({
  name: 'orders.list',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const { page: pageNumber = 1, size = 20, since, until } = ctx.config;
    return getOrderListView(ctx.page, { page: pageNumber, size, since, until }, ctx);
  },
});

export default run;
