import { withCommand } from '../_runner.js';
import { collectGoodsInput } from '../../services/diagnose/collectors.js';
import { renderSingleDashboard } from './shop.js';
import { scoreInventoryHealth } from '../../services/diagnose/index.js';

export const run = withCommand({
  name: 'diagnose.inventory',
  needsAuth: true,
  needsMall: 'switch',
  render: renderSingleDashboard,
  async run(ctx) {
    const mallId = ctx.mallCtx?.activeId ?? null;
    const input = await collectGoodsInput(ctx.page, { mallId });
    return scoreInventoryHealth(input ?? {});
  },
});

export default run;
