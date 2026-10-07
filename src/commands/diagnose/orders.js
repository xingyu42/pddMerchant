import { withCommand } from '../_runner.js';
import { renderSingleDashboard } from './_render.js';
import { getOrdersDiagnosis } from '../../services/diagnose/reports.js';

export const run = withCommand({
  name: 'diagnose.orders',
  needsAuth: true,
  needsMall: 'switch',
  render: renderSingleDashboard,
  async run(ctx) {
    return getOrdersDiagnosis(ctx);
  },
});

export default run;
