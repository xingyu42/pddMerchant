// 📦 Orders 分组注册（design D-3）
import { InvalidArgumentError, Option } from 'commander';
import * as list from '../orders/list.js';
import * as detail from '../orders/detail.js';
import * as stats from '../orders/stats.js';
import * as afterSales from '../orders/after-sales.js';
import {
  goodsIdArg, integerArg, nonEmptyStringArg, preserveParseErrorCommand, reportDaysArg,
  shanghaiTimeBoundArg, validateParsedOptions,
} from '../option-parsers.js';
import {
  AFTER_SALES_CLI_STATUSES, AFTER_SALES_CLI_TYPES, AFTER_SALES_DEFAULT_MAX_TRACK_FETCHES,
  AFTER_SALES_DEFAULT_STATUS, AFTER_SALES_DEFAULT_TYPE, AFTER_SALES_MAX_TRACK_FETCHES_LIMIT, AFTER_SALES_REPORT,
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
  const detailCommand = orders
    .command('detail')
    .description('订单详情（按订单号查询，加 --with-track 附带正向与退回物流轨迹及耗时）')
    .requiredOption('--sn <sn>', '订单号 / shipping_id', nonEmptyStringArg('订单号'))
    .option('--with-track', '附带正向物流轨迹与关联售后逆向退货轨迹及耗时', false);
  preserveParseErrorCommand(detailCommand);
  wireAction(detailCommand, 'orders.detail', detail.run);
  wireAction(
    orders
      .command('stats')
      .description('订单统计（远程 + 本地聚合 P50/P95；加 --with-regions 附带近 7 天省级成团地域分布）')
      .option('--size <n>', '本地聚合样本数', integerArg(1), 50)
      .option('--with-regions', '附带近 7 天省级成团地域分布（数据中心成团口径）', false),
    'orders.stats',
    stats.run
  );
  registerAfterSales(orders, wireAction);
}

function registerAfterSales(orders, wireAction) {
  const afterSalesCommand = orders.command('after-sales').description('售后单列表与原因分布')
    .addOption(new Option('--days <n>', AFTER_SALES_REPORT.days.description)
      .argParser(reportDaysArg(AFTER_SALES_REPORT)).conflicts(['since', 'until']))
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
      .choices(AFTER_SALES_CLI_TYPES).default(AFTER_SALES_DEFAULT_TYPE))
    .option('--with-delivery', '补查已发货售后单的正向快递送达时间与收货到发起退货天数', false)
    .addOption(new Option(
      '--max-track-fetches <n>',
      `配合 --with-delivery，单次最多实时查询正向轨迹的去重订单数（1–${AFTER_SALES_MAX_TRACK_FETCHES_LIMIT}，默认 ${AFTER_SALES_DEFAULT_MAX_TRACK_FETCHES}）`,
    ).argParser(integerArg(1, AFTER_SALES_MAX_TRACK_FETCHES_LIMIT)));
  preserveParseErrorCommand(afterSalesCommand);
  validateParsedOptions(afterSalesCommand, ({ since, until, withDelivery, maxTrackFetches }) => {
    if (until !== undefined && since === undefined) {
      throw new InvalidArgumentError('--until 必须配合 --since 使用');
    }
    if (since !== undefined && since > (until ?? Math.floor(Date.now() / 1000))) {
      throw new InvalidArgumentError('--since 不能晚于 --until');
    }
    if (maxTrackFetches !== undefined && !withDelivery) {
      throw new InvalidArgumentError('--max-track-fetches 必须配合 --with-delivery 使用');
    }
  });
  wireAction(afterSalesCommand, 'orders.after-sales', afterSales.run);
}
