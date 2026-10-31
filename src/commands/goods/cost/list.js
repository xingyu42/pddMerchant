import { withCommand } from '../../_runner.js';
import { listGoodsCostView } from '../../../services/goods-cost.js';

export const run = withCommand({
  name: 'goods.cost.list', needsAuth: false, needsBrowser: false, needsAccount: true,
  needsMall: 'stored', allowAllAccounts: false,
  async run(ctx) {
    return { data: await listGoodsCostView(ctx, { goods_id: ctx.config.goodsId }), meta: { xhr_count: 0 } };
  },
});
