import { withCommand } from '../../infra/command-runner.js';
import { getOrderDetail } from '../../services/orders.js';
import { PddCliError, ExitCodes } from '../../infra/errors.js';

export const run = withCommand({
  name: 'orders.detail',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const { sn } = ctx.config;
    if (!sn) {
      throw new PddCliError({
        code: 'E_USAGE',
        message: 'pdd orders detail 需要 --sn <order_sn>',
        hint: '示例：pdd orders detail --sn 85',
        exitCode: ExitCodes.USAGE,
      });
    }
    const mallId = ctx.mallCtx?.activeId ?? null;
    const result = await getOrderDetail(ctx.page, sn, { mallId });
    return { order: result.order, mall_id: mallId };
  },
});

export default run;
