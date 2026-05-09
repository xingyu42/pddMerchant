import { withCommand } from '../../../infra/command-runner.js';
import { PddCliError, ExitCodes } from '../../../infra/errors.js';
import { updateGoodsTitle, validateGoodsId, validateWriteValue } from '../../../services/goods.js';

export const run = withCommand({
  name: 'goods.update.title',
  needsAuth: true,
  needsMall: 'switch',
  allowAllAccounts: false,
  async run(ctx) {
    const { goodsId, title, confirm } = ctx.config;
    const id = validateGoodsId(goodsId);
    const t = validateWriteValue('title', title);
    const mallId = ctx.mallCtx?.activeId ?? null;

    if (!confirm) {
      return {
        data: {
          goods_id: id,
          field: 'title',
          value: t,
          dry_run: true,
        },
        meta: { xhr_count: 0, mall: mallId },
      };
    }

    const result = await updateGoodsTitle(ctx.page, id, t, ctx);
    return {
      data: {
        goods_id: id,
        field: 'title',
        value: t,
        dry_run: false,
        result,
      },
      meta: { xhr_count: 1, mall: mallId, confirm: true },
    };
  },
});

export default run;
