import { withCommand } from '../../infra/command-runner.js';
import { renderSingleDashboard } from './shop.js';
import { scoreFunnelHealth } from '../../services/diagnose/index.js';
import { listOrders, computeOrderStats } from '../../services/orders.js';

const FUNNEL_WINDOW_DAYS = 30;
const FUNNEL_PAGE_SIZE = 100;

export const run = withCommand({
  name: 'diagnose.funnel',
  needsAuth: true,
  needsMall: 'switch',
  render: renderSingleDashboard,
  async run(ctx) {
    const mallId = ctx.mallCtx?.activeId ?? null;
    const now = Math.floor(Date.now() / 1000);
    const since = now - FUNNEL_WINDOW_DAYS * 86400;
    try {
      const result = await listOrders(ctx.page, { page: 1, size: FUNNEL_PAGE_SIZE, since, until: now }, { mallId });
      const orderStats = computeOrderStats(result?.orders ?? []);
      return scoreFunnelHealth({ orderStats, windowDays: FUNNEL_WINDOW_DAYS });
    } catch {
      return scoreFunnelHealth({});
    }
  },
});

export default run;
