import { withCommand } from '../../../infra/command-runner.js';
import { PddCliError, ExitCodes } from '../../../infra/errors.js';
import { listGoods, updateGoodsStatus, validateGoodsId, validateWriteValue } from '../../../services/goods.js';

export const run = withCommand({
  name: 'goods.update.status',
  needsAuth: true,
  needsMall: 'switch',
  allowAllAccounts: false,
  async run(ctx) {
    const { goodsId, status, confirm } = ctx.config;
    const id = validateGoodsId(goodsId);
    validateWriteValue('status', status);
    const mallId = ctx.mallCtx?.activeId ?? null;

    if (!confirm) {
      return {
        data: {
          goods_id: id,
          field: 'status',
          value: status,
          dry_run: true,
        },
        meta: { xhr_count: 0, mall: mallId },
      };
    }

    const result = await updateGoodsStatus(ctx.page, id, status, ctx);
    return {
      data: {
        goods_id: id,
        field: 'status',
        value: status,
        dry_run: false,
        result,
      },
      meta: { xhr_count: 1, mall: mallId, confirm: true },
    };
  },
});

export default run;
