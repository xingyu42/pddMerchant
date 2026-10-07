import { withCommand } from '../_runner.js';
import { renderSingleDashboard } from './_render.js';
import { getPromoDiagnosis } from '../../services/diagnose/reports.js';

export const run = withCommand({
  name: 'diagnose.promo',
  needsAuth: true,
  needsMall: 'switch',
  render: renderSingleDashboard,
  async run(ctx) {
    return getPromoDiagnosis(ctx);
  },
});

export default run;
