import { withCommand } from '../../infra/command-runner.js';
import { listMalls } from '../../adapter/mall-reader.js';

export const run = withCommand({
  name: 'shops.list',
  needsAuth: true,
  needsMall: 'current',
  async run(ctx) {
    const cached = ctx.mallCtx?.malls;
    if (Array.isArray(cached) && cached.length > 0) return cached;
    return listMalls(ctx.page);
  },
});

export default run;
