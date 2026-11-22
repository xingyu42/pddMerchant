// 📦 Orders 分组注册（design D-3）
import { InvalidArgumentError, Option } from 'commander';
import * as list from '../orders/list.js';
import * as detail from '../orders/detail.js';
import * as stats from '../orders/stats.js';
import * as afterSales from '../orders/after-sales.js';
import {
  goodsIdArg, integerArg, nonEmptyStringArg, preserveParseErrorCommand, shanghaiTimeBoundArg, validateParsedOptions,
} from '../option-parsers.js';
import {
  AFTER_SALES_CLI_STATUSES, AFTER_SALES_CLI_TYPES, AFTER_SALES_DEFAULT_STATUS, AFTER_SALES_DEFAULT_TYPE,
} from '../../services/after-sales.js';

export function register(program, wireAction) {
  const orders = program.command('orders').description('📦 订单管理');
  wireAction(
    orders
      .command('list')
      .description('订单列表')
      .option('--page <n>', '页码', integerArg(1), 1)
      .option('--size <n>', '每页数量', integerArg(1), 20)
      .option('--since <unix>', '起始时间（Unix 秒）', integerArg(0))
      .option('--until <unix>', '结束时间（Unix 秒）', integerArg(0))
      .option('--status <scope>', '订单范围：all|pending_ship|shipped|received|after_sales', 'all'),
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
      .option('--size <n>', '本地聚合样本数', integerArg(1), 50),
    'orders.stats',
    stats.run
  );
  const afterSalesCommand = orders.command('after-sales').description('售后单列表与原因分布')
    .addOption(new Option('--days <n>', '售后申请时间窗口天数（1–365，默认 30）')
      .argParser(integerArg(1, 365)).conflicts(['since', 'until']))
    .addOption(new Option('--since <time>', '起始时间（YYYY-MM-DD 按北京时间 00:00:00，或 Unix 秒）')
      .argParser(shanghaiTimeBoundArg('start')).conflicts('days'))
    .addOption(new Option('--until <time>', '结束时间（YYYY-MM-DD 按北京时间 23:59:59，或 Unix 秒）')
      .argParser(shanghaiTimeBoundArg('end')).conflicts('days'))
    .addOption(new Option('--sn <order_sn>', '按订单号筛选（未传时间参数时默认查全历史，与 --goods-id 互斥）')
      .argParser(nonEmptyStringArg('订单号')).conflicts('goodsId'))
    .addOption(new Option('--goods-id <id>', '按商品 ID 筛选（与 --sn 互斥）')
      .argParser(goodsIdArg).conflicts('sn'))
    .addOption(new Option('--status <scope>', '售后状态筛选：all|open|refunded|closed')
      .choices(AFTER_SALES_CLI_STATUSES).default(AFTER_SALES_DEFAULT_STATUS))
    .addOption(new Option('--type <kind>', '售后类型筛选：all|refund|return_refund|exchange|resend|repair')
      .choices(AFTER_SALES_CLI_TYPES).default(AFTER_SALES_DEFAULT_TYPE));
  preserveParseErrorCommand(afterSalesCommand);
  validateParsedOptions(afterSalesCommand, ({ since, until }) => {
    if (until !== undefined && since === undefined) {
      throw new InvalidArgumentError('--until 必须配合 --since 使用');
    }
    if (since !== undefined && since > (until ?? Math.floor(Date.now() / 1000))) {
      throw new InvalidArgumentError('--since 不能晚于 --until');
    }
  });
  wireAction(afterSalesCommand, 'orders.after-sales', afterSales.run);
}
