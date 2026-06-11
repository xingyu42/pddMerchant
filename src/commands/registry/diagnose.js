// 🩺 Diagnose 分组注册（design D-3）
import * as shop from '../diagnose/shop.js';
import * as orders from '../diagnose/orders.js';
import * as inventory from '../diagnose/inventory.js';
import * as promo from '../diagnose/promo.js';
import * as funnel from '../diagnose/funnel.js';

export function register(program, wireAction) {
  const diagnose = program.command('diagnose').description('🩺 店铺健康诊断');
  wireAction(
    diagnose.command('shop').description('店铺总分（4 维度加权平均）')
      .option('--compare', '启用环比对比')
      .option('--days <n>', '对比窗口天数', (v) => Number(v), 7),
    'diagnose.shop',
    shop.run
  );
  wireAction(
    diagnose.command('orders').description('订单维度健康（P95 / 退款 / 堆积）'),
    'diagnose.orders',
    orders.run
  );
  wireAction(
    diagnose.command('inventory').description('库存维度健康（缺货 / 低库存）'),
    'diagnose.inventory',
    inventory.run
  );
  wireAction(
    diagnose.command('promo').description('推广维度健康（ROI / CTR）'),
    'diagnose.promo',
    promo.run
  );
  wireAction(
    diagnose.command('funnel').description('漏斗维度健康（退款率 / 履约率）')
      .option('--days <n>', '分析窗口天数', (v) => Number(v), 30),
    'diagnose.funnel',
    funnel.run
  );
}
