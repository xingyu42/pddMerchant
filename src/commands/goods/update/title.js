import { withCommand } from '../../_runner.js';
import { executeGoodsWrite } from '../../../services/goods-write.js';

export const run = withCommand({
  name: 'goods.update.title',
  needsAuth: true,
  needsMall: 'switch',
  allowAllAccounts: false,
  async run(ctx) {
    const { goodsId, title, confirm } = ctx.config;
    const data = await executeGoodsWrite(ctx, {
      field: 'title', goodsId, value: title, confirm,
    });
    return { data, meta: { xhr_count: data.dry_run ? 0 : 1 } };
  },
});

export default run;
