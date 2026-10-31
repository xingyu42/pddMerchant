import { withCommand } from '../_runner.js';
import { getTrafficView } from '../../services/traffic.js';

export const run = withCommand({
  name: 'diagnose.traffic', needsAuth: true, needsMall: 'switch',
  async run(ctx) { return getTrafficView(ctx, { days: ctx.config?.days }); },
});

export default run;
