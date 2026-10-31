import { withCommand } from '../../_runner.js';
import { importGoodsCostView } from '../../../services/goods-cost.js';

export const run = withCommand({
  name: 'goods.cost.import', needsAuth: false, needsBrowser: false, needsAccount: true,
  needsMall: 'stored', allowAllAccounts: false,
  async run(ctx) {
    return { data: await importGoodsCostView(ctx, { file: ctx.config.args?.[0], confirm: ctx.config.confirm }), meta: { xhr_count: 0 } };
  },
});
