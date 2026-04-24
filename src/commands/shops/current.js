import { withCommand } from '../../infra/command-runner.js';

export const run = withCommand({
  name: 'shops.current',
  needsAuth: true,
  needsMall: 'current',
  async run(ctx) {
    const mall = ctx.mallCtx;
    return {
      id: mall?.activeId ?? null,
      name: mall?.activeName ?? '',
      source: mall?.source ?? null,
    };
  },
});

export default run;
