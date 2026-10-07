import { withCommand } from '../../_runner.js';
import { executeGoodsWrite } from '../../../services/goods-write.js';

export const run = withCommand({
  name: 'goods.update.price',
  needsAuth: true,
  needsMall: 'switch',
  allowAllAccounts: false,
  async run(ctx) {
    const { goodsId, priceYuan, confirm, skuId } = ctx.config;
    const data = await executeGoodsWrite(ctx, {
      field: 'price_yuan', goodsId, value: priceYuan, skuId, confirm,
    });
    return { data, meta: { xhr_count: data.dry_run ? 0 : 1 } };
  },
});

export default run;
