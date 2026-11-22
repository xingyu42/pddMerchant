import { withCommand } from '../_runner.js';
import { getAfterSalesView } from '../../services/after-sales.js';

export const run = withCommand({
  name: 'orders.after-sales',
  needsAuth: true,
  needsMall: 'switch',
  run: (ctx) => getAfterSalesView(ctx, { days: ctx.config.days }),
});
