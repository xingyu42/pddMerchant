import { withCommand } from '../../infra/command-runner.js';
import { listOrders, getOrderStats, computeOrderStats } from '../../services/orders.js';

export const run = withCommand({
  name: 'orders.stats',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const { size = 50 } = ctx.config;
    const mallId = ctx.mallCtx?.activeId ?? null;

    const remote = await getOrderStats(ctx.page, { mallId });
    const listRes = await listOrders(ctx.page, { page: 1, size }, { mallId });
    const local = computeOrderStats(listRes.orders);

    return {
      remote: {
        unship: remote.unship,
        unship12h: remote.unship12h,
        delay: remote.delay,
        unreceive: remote.unreceive,
      },
      local,
      mall_id: mallId,
    };
  },
});

export default run;
