import { withCommand } from '../_runner.js';
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { publishGoodsFromLink } from '../../services/goods-publish.js';

export const run = withCommand({
  name: 'goods.publish',
  needsAuth: true,
  needsMall: 'switch',
  allowAllAccounts: false,
  async run(ctx) {
    const { url, confirm } = ctx.config;
    const mallId = ctx.mallCtx?.activeId ?? null;

    if (!url) {
      throw new PddCliError({
        code: 'E_USAGE',
        message: '--url 参数必填',
        hint: '用法: pdd goods publish --url <商品链接>',
        exitCode: ExitCodes.USAGE,
      });
    }

    const result = await publishGoodsFromLink(ctx, url, { draftOnly: !confirm });
    return {
      data: result,
      meta: {
        mall: mallId,
        goods_id: result.goods_id,
        goods_commit_id: result.goods_commit_id,
        status: result.status,
      },
    };
  },
});

export default run;
