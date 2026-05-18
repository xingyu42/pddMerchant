import { withCommand } from '../../infra/command-runner.js';
import { listCostTemplates } from '../../services/goods-publish.js';

export const run = withCommand({
  name: 'goods.templates',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const templates = await listCostTemplates(ctx);
    return {
      data: templates,
      meta: { total: templates.length },
    };
  },
});

export default run;
