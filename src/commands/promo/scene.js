import { withCommand } from '../../infra/command-runner.js';
import { getScenePromo } from '../../services/promo.js';

export const run = withCommand({
  name: 'promo.scene',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const { page: pageNum, size, since } = ctx.config;
    const mallId = ctx.mallCtx?.activeId ?? null;
    const result = await getScenePromo(ctx.page, { page: pageNum, size, since }, ctx);
    return { mallId, entities: result.entities, totals: result.totals, count: result.entities.length };
  },
});

export default run;
