import { withCommand } from '../_runner.js';
import { renderSingleDashboard } from './_render.js';
import { getAfterSalesDiagnosis } from '../../services/diagnose/reports.js';

export const run = withCommand({
  name: 'diagnose.after-sales',
  needsAuth: true,
  needsMall: 'switch',
  render: renderSingleDashboard,
  async run(ctx) {
    return getAfterSalesDiagnosis(ctx, { days: ctx.config?.days });
  },
});

export default run;
