import { withCommand } from '../_runner.js';
import { getExperiencePlanView } from '../../services/experience-plan.js';

export const run = withCommand({
  name: 'diagnose.experience-plan', needsAuth: true, needsMall: 'switch',
  async run(ctx) {
    return getExperiencePlanView(ctx, { days: ctx.config?.days, page: ctx.config?.page });
  },
});
