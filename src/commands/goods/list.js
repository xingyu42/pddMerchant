import { withCommand } from '../../infra/command-runner.js';
import { listGoods } from '../../services/goods.js';

export const run = withCommand({
  name: 'goods.list',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const { page: pageNum, size, status } = ctx.config;
    const mallId = ctx.mallCtx?.activeId ?? null;
    const result = await listGoods(ctx.page, { page: pageNum, size, status }, { mallId });
    return {
      data: result.goods,
      meta: { xhr_count: 1, total: result.total, mall: mallId },
    };
  },
});

export default run;
