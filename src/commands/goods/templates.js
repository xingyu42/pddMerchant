import { withCommand } from '../_runner.js';
import { getCostTemplatesView } from '../../services/goods-publish.js';

export const run = withCommand({
  name: 'goods.templates',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    return getCostTemplatesView(ctx);
  },
});

export default run;
