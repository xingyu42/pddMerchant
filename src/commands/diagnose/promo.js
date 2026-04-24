import { withCommand } from '../../infra/command-runner.js';
import { collectPromoInput, renderSingleDashboard } from './shop.js';
import { scorePromoHealth } from '../../services/diagnose/index.js';

export const run = withCommand({
  name: 'diagnose.promo',
  needsAuth: true,
  needsMall: 'switch',
  render: renderSingleDashboard,
  async run(ctx) {
    const mallId = ctx.mallCtx?.activeId ?? null;
    const input = await collectPromoInput(ctx.page, { mallId });
    return scorePromoHealth(input ?? {});
  },
});

export default run;
