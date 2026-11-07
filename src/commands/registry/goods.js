// 🛍️ Goods 分组注册：读操作 + update 写操作子组 + publish/templates（design D-3）
import * as list from '../goods/list.js';
import * as stock from '../goods/stock.js';
import * as segment from '../goods/segment.js';
import * as updateStatus from '../goods/update/status.js';
import * as updatePrice from '../goods/update/price.js';
import * as updateStock from '../goods/update/stock.js';
import * as updateTitle from '../goods/update/title.js';
import * as updateBatch from '../goods/update/batch.js';
import * as publish from '../goods/publish.js';
import * as templates from '../goods/templates.js';
import * as costList from '../goods/cost/list.js';
import * as costSet from '../goods/cost/set.js';
import * as costRemove from '../goods/cost/remove.js';
import * as costImport from '../goods/cost/import.js';
import * as profit from '../goods/profit.js';
import * as traffic from '../goods/traffic.js';
import * as receipt from '../goods/receipt.js';
import { integerArg, withReportDays } from '../option-parsers.js';
import { GOODS_TRAFFIC_REPORT } from '../../services/goods-traffic.js';
import { GOODS_PROFIT_REPORT } from '../../services/goods-profit.js';

function registerCosts(goods, wireAction) {
  const costs = goods.command('cost').description('本地商品成本（写入需 --confirm）');
  wireAction(costs.command('list').option('--goods-id <id>', '商品 ID'), 'goods.cost.list', costList.run);
  wireAction(costs.command('set').requiredOption('--goods-id <id>', '商品 ID').option('--spec <text>', '精确规格文本')
    .requiredOption('--purchase-yuan <yuan>', '每件货本（元）').requiredOption('--packaging-yuan <yuan>', '每单包材（元）')
    .requiredOption('--courier-yuan <yuan>', '每单快递（元）').option('--insurance-yuan <yuan>', '每单运费险（元）')
    .option('--technical-service-yuan <yuan>', '每单技术服务费（元）').option('--confirm', '确认保存，默认预演'),
  'goods.cost.set', costSet.run);
  wireAction(costs.command('remove').requiredOption('--goods-id <id>', '商品 ID')
    .option('--spec <text>', '仅删除此规格；缺省仅删除默认行').option('--confirm', '确认删除，默认预演'),
  'goods.cost.remove', costRemove.run);
  wireAction(costs.command('import <file>').description('导入 JSON 成本记录').option('--confirm', '确认导入，默认预演'),
    'goods.cost.import', costImport.run);
}

function registerReads(goods, wireAction) {
  wireAction(withReportDays(goods.command('traffic').description('商品区间流量与推广直接成交拆分'), GOODS_TRAFFIC_REPORT)
    .option('--goods-id <id>', '商品 ID'), 'goods.traffic', traffic.run);
  wireAction(goods.command('receipt').description('SKU 预估实收（平台报告值，按商家出资口径）')
    .option('--goods-id <id>', '商品 ID，可重复或逗号分隔', (value, previous = []) => [...previous, value])
    .option('--page <n>', '页码', integerArg(1), 1)
    .option('--size <n>', '每页商品数（1–10）', integerArg(1), 10)
    .option('--caliber <name>', '商家出资口径：regular（常规优惠）| all（所有优惠）', 'regular'),
  'goods.receipt', receipt.run);
  wireAction(
    goods
      .command('list')
      .description('商品列表')
      .option('--page <n>', '页码', integerArg(1), 1)
      .option('--size <n>', '每页数量', integerArg(1), 10)
      .option('--status <s>', '状态筛选：onsale | offline', 'onsale'),
    'goods.list',
    list.run
  );
  wireAction(
    goods
      .command('stock')
      .description('库存告警（按阈值筛低库存/缺货）')
      .option('--page <n>', '页码', integerArg(1), 1)
      .option('--size <n>', '每页数量', integerArg(1), 50)
      .option('--threshold <n>', '低库存阈值', integerArg(0), 10),
    'goods.stock',
    stock.run
  );
  wireAction(
    goods
      .command('segment')
      .description('商品销量与库存统计')
      .option('--days <n>', '销量统计窗口天数', (value) => Number(value), 30)
      .option('--size <n>', '商品分页大小', integerArg(1), 50)
      .option('--max-pages <n>', '最大商品页数', integerArg(1), 10)
      .option('--no-promo', '跳过推广 ROI 数据'),
    'goods.segment',
    segment.run
  );
}

function registerStatusAndPrice(goodsUpdate, wireAction) {
  wireAction(
    goodsUpdate
      .command('status')
      .description('上下架')
      .requiredOption('--goods-id <id>', '商品 ID', (value) => Number(value))
      .requiredOption('--status <s>', '目标状态: onsale | offline')
      .option('--confirm', '确认执行（默认 dry-run）'),
    'goods.update.status',
    updateStatus.run
  );
  wireAction(
    goodsUpdate
      .command('price')
      .description('修改价格')
      .requiredOption('--goods-id <id>', '商品 ID', (value) => Number(value))
      .requiredOption('--price-yuan <yuan>', '价格（元，最多 2 位小数，例如 29.9）')
      .option('--sku-id <id>', 'SKU ID（可选）')
      .option('--confirm', '确认执行（默认 dry-run）'),
    'goods.update.price',
    updatePrice.run
  );
}

function registerOtherUpdates(goodsUpdate, wireAction) {
  wireAction(
    goodsUpdate
      .command('stock')
      .description('修改库存')
      .requiredOption('--goods-id <id>', '商品 ID', (value) => Number(value))
      .requiredOption('--quantity <n>', '库存数量', (value) => Number(value))
      .option('--sku-id <id>', 'SKU ID（可选）')
      .option('--confirm', '确认执行（默认 dry-run）'),
    'goods.update.stock',
    updateStock.run
  );
  wireAction(
    goodsUpdate
      .command('title')
      .description('修改标题')
      .requiredOption('--goods-id <id>', '商品 ID', (value) => Number(value))
      .requiredOption('--title <text>', '新标题')
      .option('--confirm', '确认执行（默认 dry-run）'),
    'goods.update.title',
    updateTitle.run
  );
  wireAction(
    goodsUpdate
      .command('batch')
      .description('批量编辑（JSON 输入）')
      .requiredOption('--changes <json>', '变更列表 JSON: [{"goods_id":1001,"field":"price_yuan","value":29.9}]（field: status|price_yuan|stock|title，价格单位为元）')
      .option('--confirm', '确认执行（默认 dry-run）'),
    'goods.update.batch',
    updateBatch.run
  );
}

function registerPublishing(goods, wireAction) {
  wireAction(
    goods
      .command('publish')
      .description('从 PDD 商品链接上货（默认创建草稿，--confirm 提交发布）')
      .requiredOption('--url <url>', '源商品链接或纯数字 goods_id')
      .option('--confirm', '直接提交发布（默认仅创建草稿）')
      .option('--cost-template <id>', '运费模板 ID（默认取第一个）'),
    'goods.publish',
    publish.run
  );

  wireAction(
    goods
      .command('templates')
      .description('查看可用运费模板（获取 ID 用于 --cost-template）'),
    'goods.templates',
    templates.run
  );
}

export function register(program, wireAction) {
  const goods = program.command('goods').description('🛍️ 商品管理');
  registerCosts(goods, wireAction);
  wireAction(withReportDays(goods.command('profit').description('商品净利润（商品推广报表口径）'), GOODS_PROFIT_REPORT)
    .option('--goods-id <id>', '只筛商品列表，全店合计保持原样'), 'goods.profit', profit.run);
  registerReads(goods, wireAction);
  const goodsUpdate = goods.command('update').description('商品编辑（写操作，需 --confirm 确认）');
  registerStatusAndPrice(goodsUpdate, wireAction);
  registerOtherUpdates(goodsUpdate, wireAction);
  registerPublishing(goods, wireAction);
}
