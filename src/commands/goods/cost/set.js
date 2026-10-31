import { withCommand } from '../../_runner.js';
import { setGoodsCostView } from '../../../services/goods-cost.js';

export const run = withCommand({
  name: 'goods.cost.set', needsAuth: false, needsBrowser: false, needsAccount: true,
  needsMall: 'stored', allowAllAccounts: false,
  async run(ctx) {
    const config = ctx.config;
    const input = { goods_id: config.goodsId, spec: config.spec, purchase_yuan: config.purchaseYuan,
      packaging_yuan: config.packagingYuan, courier_yuan: config.courierYuan, confirm: config.confirm };
    if (config.insuranceYuan !== undefined) input.insurance_yuan = config.insuranceYuan;
    if (config.technicalServiceYuan !== undefined) input.technical_service_yuan = config.technicalServiceYuan;
    return { data: await setGoodsCostView(ctx, input), meta: { xhr_count: 0 } };
  },
});
