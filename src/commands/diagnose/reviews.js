import { withCommand } from '../_runner.js';
import { getReviewsView } from '../../services/reviews.js';

export const run = withCommand({
  name: 'diagnose.reviews', needsAuth: true, needsMall: 'switch',
  async run(ctx) {
    return getReviewsView(ctx, { days: ctx.config?.days });
  },
});

export default run;
