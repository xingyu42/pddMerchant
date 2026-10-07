import { withCommand } from '../_runner.js';
import { renderSingleDashboard } from './_render.js';
import { getInventoryDiagnosis } from '../../services/diagnose/reports.js';

export const run = withCommand({
  name: 'diagnose.inventory',
  needsAuth: true,
  needsMall: 'switch',
  render: renderSingleDashboard,
  async run(ctx) {
    return getInventoryDiagnosis(ctx);
  },
});

export default run;
