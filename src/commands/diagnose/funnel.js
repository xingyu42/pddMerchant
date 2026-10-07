import { withCommand } from '../_runner.js';
import { renderSingleDashboard } from './_render.js';
import { getFunnelDiagnosis } from '../../services/diagnose/reports.js';

export const run = withCommand({
  name: 'diagnose.funnel',
  needsAuth: true,
  needsMall: 'switch',
  render: renderSingleDashboard,
  async run(ctx) {
    return getFunnelDiagnosis(ctx, { days: ctx.config?.days });
  },
});

export default run;
