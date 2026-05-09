import { withCommand } from '../../../infra/command-runner.js';
import { PddCliError, ExitCodes } from '../../../infra/errors.js';
import { updateGoodsStock, validateGoodsId, validateWriteValue } from '../../../services/goods.js';

export const run = withCommand({
  name: 'goods.update.stock',
  needsAuth: true,
  needsMall: 'switch',
  allowAllAccounts: false,
  async run(ctx) {
    const { goodsId, quantity, confirm, skuId } = ctx.config;
    const id = validateGoodsId(goodsId);
    const q = validateWriteValue('stock', quantity);
    const mallId = ctx.mallCtx?.activeId ?? null;

    if (!confirm) {
      return {
        data: {
          goods_id: id,
          field: 'stock',
          value: q,
          sku_id: skuId ?? null,
          dry_run: true,
        },
        meta: { xhr_count: 0, mall: mallId },
      };
    }

    const result = await updateGoodsStock(ctx.page, id, q, ctx);
    return {
      data: {
        goods_id: id,
        field: 'stock',
        value: q,
        sku_id: skuId ?? null,
        dry_run: false,
        result,
      },
      meta: { xhr_count: 1, mall: mallId, confirm: true },
    };
  },
});

export default run;
