import { withCommand } from '../_runner.js';
import { renderShopDashboard } from './_render.js';
import { getShopDiagnosis } from '../../services/diagnose/reports.js';

export const run = withCommand({
  name: 'diagnose.shop',
  needsAuth: true,
  needsMall: 'switch',
  render: renderShopDashboard,
  async run(ctx) {
    return getShopDiagnosis(ctx, { compare: ctx.config.compare ?? false, days: ctx.config.days ?? 7 });
  },
});

export default run;
