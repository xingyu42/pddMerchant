import { withCommand } from '../../infra/command-runner.js';
import { listMalls } from '../../adapter/mall-reader.js';

export const run = withCommand({
  name: 'shops.list',
  needsAuth: true,
  needsMall: 'current',
  async run(ctx) {
    const malls = ctx.mallCtx?.malls ?? await listMalls(ctx.page);
    return malls;
  },
});

export default run;
