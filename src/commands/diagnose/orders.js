import { withCommand } from '../../infra/command-runner.js';
import { collectOrdersInput, renderSingleDashboard } from './shop.js';
import { scoreOrdersHealth } from '../../services/diagnose/index.js';

export const run = withCommand({
  name: 'diagnose.orders',
  needsAuth: true,
  needsMall: 'switch',
  render: renderSingleDashboard,
  async run(ctx) {
    const mallId = ctx.mallCtx?.activeId ?? null;
    const input = await collectOrdersInput(ctx.page, { mallId });
    return scoreOrdersHealth(input ?? {});
  },
});

export default run;
