import { withCommand } from '../../_runner.js';
import { executeGoodsWrite } from '../../../services/goods-write.js';

export const run = withCommand({
  name: 'goods.update.stock',
  needsAuth: true,
  needsMall: 'switch',
  allowAllAccounts: false,
  async run(ctx) {
    const { goodsId, quantity, confirm, skuId } = ctx.config;
    const data = await executeGoodsWrite(ctx, {
      field: 'stock', goodsId, value: quantity, skuId, confirm,
    });
    return { data, meta: { xhr_count: data.dry_run ? 0 : 1 } };
  },
});

export default run;
