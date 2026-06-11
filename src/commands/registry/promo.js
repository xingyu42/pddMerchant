// 🚀 Promo 分组注册（design D-3）
import * as search from '../promo/search.js';
import * as scene from '../promo/scene.js';
import * as roi from '../promo/roi.js';

export function register(program, wireAction) {
  const promo = program.command('promo').description('🚀 推广报表');
  wireAction(
    promo
      .command('search')
      .description('搜索推广 / 全量推广实体报表')
      .option('--since <date>', '起始日期 YYYY-MM-DD')
      .option('--page <n>', '页码', (v) => Number(v), 1)
      .option('--size <n>', '每页数量', (v) => Number(v), 10),
    'promo.search',
    search.run
  );
  wireAction(
    promo
      .command('scene')
      .description('场景推广报表')
      .option('--since <date>', '起始日期 YYYY-MM-DD')
      .option('--page <n>', '页码', (v) => Number(v), 1)
      .option('--size <n>', '每页数量', (v) => Number(v), 10),
    'promo.scene',
    scene.run
  );
  wireAction(
    promo
      .command('roi')
      .description('推广 ROI 诊断（按计划/商品/渠道维度）')
      .option('--by <dimension>', '分组维度 plan|sku|channel', 'plan')
      .option('--since <date>', '起始日期 YYYY-MM-DD')
      .option('--page <n>', '页码', (v) => Number(v), 1)
      .option('--size <n>', '每页数量', (v) => Number(v), 50)
      .option('--break-even <n>', '保本 ROI 阈值', (v) => Number(v), 1.0)
      .option('--include-inactive', '包含已删除/暂停计划'),
    'promo.roi',
    roi.run
  );
}
