import { withCommand } from '../_runner.js';
import { getOrderStatsView } from '../../services/orders.js';

export const run = withCommand({
  name: 'orders.stats',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const { size = 50 } = ctx.config;
    return getOrderStatsView(ctx.page, { size }, ctx);
  },
});

export default run;
