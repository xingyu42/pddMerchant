import { withCommand } from '../../infra/command-runner.js';
import { getPromoRoi } from '../../services/promo-roi.js';

export const run = withCommand({
  name: 'promo.roi',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const { page: pageNum, size, since, by, breakEven, includeInactive } = ctx.config;
    const result = await getPromoRoi(ctx.page, { page: pageNum, size, since, by, breakEven, includeInactive }, ctx);
    const { warnings: resultWarnings, ...data } = result;
    return { data, warnings: resultWarnings };
  },
});

export default run;
