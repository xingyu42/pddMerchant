import { withCommand } from '../_runner.js';
import { collectOrdersInput } from '../../services/diagnose/collectors.js';
import { renderSingleDashboard } from './shop.js';
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
