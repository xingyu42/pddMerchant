import { withCommand } from '../_runner.js';
import { getGoodsReceiptView } from '../../services/goods-receipt.js';

export const run = withCommand({
  name: 'goods.receipt', needsAuth: true, needsMall: 'switch',
  async run(ctx) {
    const { goodsId, page, size, caliber } = ctx.config ?? {};
    return getGoodsReceiptView(ctx, { goodsIds: goodsId, page, size, caliber });
  },
});

export default run;
