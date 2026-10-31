import { withCommand } from '../../_runner.js';
import { removeGoodsCostView } from '../../../services/goods-cost.js';

export const run = withCommand({
  name: 'goods.cost.remove', needsAuth: false, needsBrowser: false, needsAccount: true,
  needsMall: 'stored', allowAllAccounts: false,
  async run(ctx) {
    const { goodsId, spec, confirm } = ctx.config;
    return { data: await removeGoodsCostView(ctx, { goods_id: goodsId, spec, confirm }), meta: { xhr_count: 0 } };
  },
});
