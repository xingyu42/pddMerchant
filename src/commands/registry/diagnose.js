// 🩺 Diagnose 分组注册（design D-3）
import * as shop from '../diagnose/shop.js';
import * as orders from '../diagnose/orders.js';
import * as inventory from '../diagnose/inventory.js';
import * as promo from '../diagnose/promo.js';
import * as afterSales from '../diagnose/after-sales.js';
import * as experience from '../diagnose/experience.js';
import * as customerService from '../diagnose/customer-service.js';
import * as reviews from '../diagnose/reviews.js';
import * as traffic from '../diagnose/traffic.js';
import { withReportDays } from '../option-parsers.js';
import { TRAFFIC_REPORT } from '../../services/traffic.js';
import { CUSTOMER_SERVICE_REPORT } from '../../services/customer-service.js';
import { REVIEWS_REPORT } from '../../services/reviews.js';
import { EXPERIENCE_REPORT } from '../../services/experience.js';

function registerServiceReports(diagnose, wireAction) {
  wireAction(withReportDays(diagnose.command('traffic').description('全店逐日流量与平台同行指标'), TRAFFIC_REPORT),
    'diagnose.traffic', traffic.run);
  wireAction(
    withReportDays(diagnose.command('customer-service').description('多多客服人工回复数据与逐日趋势'), CUSTOMER_SERVICE_REPORT),
    'diagnose.customer-service', customerService.run
  );
  wireAction(
    withReportDays(diagnose.command('reviews').description('评价标签、问题类型与中差评汇总'), REVIEWS_REPORT),
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
    withReportDays(diagnose.command('experience').description('店铺综合体验星级与指标趋势'), EXPERIENCE_REPORT),
    'diagnose.experience',
    experience.run
  );
}
