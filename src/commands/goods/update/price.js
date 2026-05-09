import { withCommand } from '../../../infra/command-runner.js';
import { PddCliError, ExitCodes } from '../../../infra/errors.js';
import { updateGoodsPrice, validateGoodsId, validateWriteValue } from '../../../services/goods.js';

export const run = withCommand({
  name: 'goods.update.price',
  needsAuth: true,
  needsMall: 'switch',
  allowAllAccounts: false,
  async run(ctx) {
    const { goodsId, price, confirm, skuId } = ctx.config;
    const id = validateGoodsId(goodsId);
    const p = validateWriteValue('price', price);
    const mallId = ctx.mallCtx?.activeId ?? null;

    if (!confirm) {
      return {
        data: {
          goods_id: id,
          field: 'price',
          value: p,
          sku_id: skuId ?? null,
          dry_run: true,
        },
        meta: { xhr_count: 0, mall: mallId },
      };
    }

    const result = await updateGoodsPrice(ctx.page, id, p, ctx);
    return {
      data: {
        goods_id: id,
        field: 'price',
        value: p,
        sku_id: skuId ?? null,
        dry_run: false,
        result,
      },
      meta: { xhr_count: 1, mall: mallId, confirm: true },
    };
  },
});

export default run;
