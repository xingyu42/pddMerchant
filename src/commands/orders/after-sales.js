import { withCommand } from '../_runner.js';
import { getAfterSalesView } from '../../services/after-sales.js';

export const run = withCommand({
  name: 'orders.after-sales',
  needsAuth: true,
  needsMall: 'switch',
  run(ctx) {
    const { days, since, until, sn, goodsId, status, type } = ctx.config;
    return getAfterSalesView(ctx, { days, since, until, sn, goodsId, status, type });
  },
});
