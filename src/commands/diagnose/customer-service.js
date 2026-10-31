import { withCommand } from '../_runner.js';
import { getCustomerServiceView } from '../../services/customer-service.js';

export const run = withCommand({
  name: 'diagnose.customer-service', needsAuth: true, needsMall: 'switch',
  async run(ctx) {
    return getCustomerServiceView(ctx, { days: ctx.config?.days });
  },
});

export default run;
