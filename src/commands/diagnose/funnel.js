import { withCommand } from '../../infra/command-runner.js';
import { renderSingleDashboard } from './shop.js';
import { scoreFunnelHealth } from '../../services/diagnose/index.js';
import { computeOrderStats } from '../../services/orders.js';
import { collectOrdersForStaleAnalysis, STALE_PAGE_SIZE } from '../../services/diagnose/orders-collector.js';

const DEFAULT_WINDOW_DAYS = 30;
const PAGES_PER_WEEK = 3;

export const run = withCommand({
  name: 'diagnose.funnel',
  needsAuth: true,
  needsMall: 'switch',
  render: renderSingleDashboard,
  async run(ctx) {
    const mallId = ctx.mallCtx?.activeId ?? null;
    const windowDays = (typeof ctx.config?.days === 'number' && ctx.config.days > 0)
      ? ctx.config.days
      : DEFAULT_WINDOW_DAYS;
    const maxPages = Math.max(10, Math.ceil(windowDays / 7) * PAGES_PER_WEEK);
    try {
      const { orders, truncated } = await collectOrdersForStaleAnalysis(
        ctx.page,
        { mallId },
        { scanDays: windowDays, maxPages, pageSize: STALE_PAGE_SIZE },
      );
      const orderStats = computeOrderStats(orders);
      const result = scoreFunnelHealth({ orderStats, windowDays });
      if (truncated) {
        result.hints.push(`订单量超出采集上限（${maxPages * STALE_PAGE_SIZE} 条），统计基于部分数据`);
      }
      return result;
    } catch {
      return scoreFunnelHealth({});
    }
  },
});

export default run;
