import { runDiagnoseCommand } from './shop.js';
import { scoreFunnelHealth } from '../../services/diagnose/index.js';
import { listOrders, computeOrderStats } from '../../services/orders.js';

const FUNNEL_WINDOW_DAYS = 30;
const FUNNEL_PAGE_SIZE = 100;

export async function run(options = {}) {
  return runDiagnoseCommand({
    command: 'diagnose.funnel',
    options,
    fetchAndScore: async (page, ctx) => {
      const now = Math.floor(Date.now() / 1000);
      const since = now - FUNNEL_WINDOW_DAYS * 86400;
      try {
        const result = await listOrders(page, { page: 1, size: FUNNEL_PAGE_SIZE, since, until: now }, ctx);
        const orderStats = computeOrderStats(result?.orders ?? []);
        return scoreFunnelHealth({ orderStats, windowDays: FUNNEL_WINDOW_DAYS });
      } catch {
        return scoreFunnelHealth({});
      }
    },
  });
}

export default run;
