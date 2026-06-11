// 📦 Orders 分组注册（design D-3）
import * as list from '../orders/list.js';
import * as detail from '../orders/detail.js';
import * as stats from '../orders/stats.js';

export function register(program, wireAction) {
  const orders = program.command('orders').description('📦 订单管理');
  wireAction(
    orders
      .command('list')
      .description('订单列表')
      .option('--page <n>', '页码', (v) => Number(v), 1)
      .option('--size <n>', '每页数量', (v) => Number(v), 20)
      .option('--since <unix>', '起始时间（Unix 秒）', (v) => Number(v))
      .option('--until <unix>', '结束时间（Unix 秒）', (v) => Number(v)),
    'orders.list',
    list.run
  );
  wireAction(
    orders
      .command('detail')
      .description('订单详情（按订单号查询）')
      .requiredOption('--sn <sn>', '订单号 / shipping_id'),
    'orders.detail',
    detail.run
  );
  wireAction(
    orders
      .command('stats')
      .description('订单统计（远程 + 本地聚合 P50/P95）')
      .option('--size <n>', '本地聚合样本数', (v) => Number(v), 50),
    'orders.stats',
    stats.run
  );
}
