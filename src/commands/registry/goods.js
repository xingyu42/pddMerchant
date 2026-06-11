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

export function register(program, wireAction) {
  const goods = program.command('goods').description('🛍️ 商品管理');
  wireAction(
    goods
      .command('list')
      .description('商品列表')
      .option('--page <n>', '页码', (v) => Number(v), 1)
      .option('--size <n>', '每页数量', (v) => Number(v), 10)
      .option('--status <s>', '状态筛选：onsale | offline', 'onsale'),
    'goods.list',
    list.run
  );
  wireAction(
    goods
      .command('stock')
      .description('库存告警（按阈值筛低库存/缺货）')
      .option('--page <n>', '页码', (v) => Number(v), 1)
      .option('--size <n>', '每页数量', (v) => Number(v), 50)
      .option('--threshold <n>', '低库存阈值', (v) => Number(v), 10),
    'goods.stock',
    stock.run
  );
  wireAction(
    goods
      .command('segment')
      .description('商品分层（A/B/C/D 四象限）')
      .option('--days <n>', '销量统计窗口天数', (v) => Number(v), 30)
      .option('--size <n>', '商品分页大小', (v) => Number(v), 50)
      .option('--max-pages <n>', '最大商品页数', (v) => Number(v), 10)
      .option('--break-even <n>', '推广保本 ROI 阈值', (v) => Number(v), 1.0)
      .option('--no-promo', '跳过推广 ROI 数据'),
    'goods.segment',
    segment.run
  );

  const goodsUpdate = goods.command('update').description('商品编辑（写操作，需 --confirm 确认）');
  wireAction(
    goodsUpdate
      .command('status')
      .description('上下架')
      .requiredOption('--goods-id <id>', '商品 ID', (v) => Number(v))
      .requiredOption('--status <s>', '目标状态: onsale | offline')
      .option('--confirm', '确认执行（默认 dry-run）'),
    'goods.update.status',
    updateStatus.run
  );
  wireAction(
    goodsUpdate
      .command('price')
      .description('修改价格')
      .requiredOption('--goods-id <id>', '商品 ID', (v) => Number(v))
      .requiredOption('--price <cents>', '价格（分）', (v) => Number(v))
      .option('--sku-id <id>', 'SKU ID（可选）')
      .option('--confirm', '确认执行（默认 dry-run）'),
    'goods.update.price',
    updatePrice.run
  );
  wireAction(
    goodsUpdate
      .command('stock')
      .description('修改库存')
      .requiredOption('--goods-id <id>', '商品 ID', (v) => Number(v))
      .requiredOption('--quantity <n>', '库存数量', (v) => Number(v))
      .option('--sku-id <id>', 'SKU ID（可选）')
      .option('--confirm', '确认执行（默认 dry-run）'),
    'goods.update.stock',
    updateStock.run
  );
  wireAction(
    goodsUpdate
      .command('title')
      .description('修改标题')
      .requiredOption('--goods-id <id>', '商品 ID', (v) => Number(v))
      .requiredOption('--title <text>', '新标题')
      .option('--confirm', '确认执行（默认 dry-run）'),
    'goods.update.title',
    updateTitle.run
  );
  wireAction(
    goodsUpdate
      .command('batch')
      .description('批量编辑（JSON 输入）')
      .requiredOption('--changes <json>', '变更列表 JSON: [{"goods_id":1001,"field":"price","value":2999}]')
      .option('--confirm', '确认执行（默认 dry-run）'),
    'goods.update.batch',
    updateBatch.run
  );

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
