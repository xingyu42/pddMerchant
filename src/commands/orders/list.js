import { withCommand } from '../../infra/command-runner.js';
import { listOrders } from '../../services/orders.js';

export const run = withCommand({
  name: 'orders.list',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const { page: pageNumber = 1, size = 20, since, until } = ctx.config;
    const mallId = ctx.mallCtx?.activeId ?? null;
    const result = await listOrders(ctx.page, { page: pageNumber, size, since, until }, ctx);
    return { total: result.total, orders: result.orders, mall_id: mallId };
  },
});

export default run;
