// 🩺 Diagnose 分组注册（design D-3）
import * as shop from '../diagnose/shop.js';
import * as orders from '../diagnose/orders.js';
import * as inventory from '../diagnose/inventory.js';
import * as promo from '../diagnose/promo.js';
import * as afterSales from '../diagnose/after-sales.js';
import * as experience from '../diagnose/experience.js';
import * as customerService from '../diagnose/customer-service.js';
import * as reviews from '../diagnose/reviews.js';

function registerServiceReports(diagnose, wireAction) {
  wireAction(
    diagnose.command('customer-service').description('多多客服人工回复数据与逐日趋势')
      .option('--days <n>', '区间天数（1-63，截至昨天）', (value) => Number(value), 30),
    'diagnose.customer-service', customerService.run
  );
  wireAction(
    diagnose.command('reviews').description('评价标签、问题类型与中差评汇总')
      .option('--days <n>', '评价窗口天数（30、60、90、180）', (value) => Number(value), 30),
    'diagnose.reviews', reviews.run
  );
}

export function register(program, wireAction) {
  const diagnose = program.command('diagnose').description('店铺数据统计');
  registerServiceReports(diagnose, wireAction);
  wireAction(
    diagnose.command('shop').description('店铺各维度数据汇总')
      .option('--compare', '启用环比对比')
      .option('--days <n>', '对比窗口天数', (v) => Number(v), 7),
    'diagnose.shop',
    shop.run
  );
  wireAction(
    diagnose.command('orders').description('订单统计（P95 / 退款 / 待发货）'),
    'diagnose.orders',
    orders.run
  );
  wireAction(
    diagnose.command('inventory').description('库存统计（缺货 / 低库存 / 零销量）'),
    'diagnose.inventory',
    inventory.run
  );
  wireAction(
    diagnose.command('promo').description('推广统计（ROI / CTR）'),
    'diagnose.promo',
    promo.run
  );
  wireAction(
    diagnose.command('after-sales').description('售后统计（退款成功 / 售后处理中）')
      .option('--days <n>', '分析窗口天数', (v) => Number(v), 30),
    'diagnose.after-sales',
    afterSales.run
  );
  wireAction(
    diagnose.command('experience').description('店铺综合体验星级与指标趋势')
      .option('--days <n>', '趋势窗口天数（1–30）', (value) => Number(value), 7),
    'diagnose.experience',
    experience.run
  );
}
