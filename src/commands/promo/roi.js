import { withCommand } from '../_runner.js';
import { getPromoRoiView } from '../../services/promo-roi.js';

export const run = withCommand({
  name: 'promo.roi',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const { page: pageNum, size, since, by, includeInactive } = ctx.config;
    return getPromoRoiView(ctx.page, { page: pageNum, size, since, by, includeInactive }, ctx);
  },
});

export default run;
