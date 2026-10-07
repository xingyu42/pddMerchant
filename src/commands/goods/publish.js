import { withCommand } from '../_runner.js';
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { publishGoodsFromLink } from '../../services/goods-publish.js';

export const run = withCommand({
  name: 'goods.publish',
  needsAuth: true,
  needsMall: 'switch',
  allowAllAccounts: false,
  async run(ctx) {
    const { url, confirm, costTemplate } = ctx.config;

    if (!url) {
      throw new PddCliError({
        code: 'E_USAGE',
        message: '--url 参数必填',
        hint: '用法: pdd goods publish --url <商品链接>',
        exitCode: ExitCodes.USAGE,
      });
    }

    return publishGoodsFromLink(ctx, url, {
      draftOnly: !confirm,
      costTemplateId: costTemplate ?? null,
    });
  },
});

export default run;
