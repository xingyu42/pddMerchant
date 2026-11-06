// 🚀 Promo 分组注册（design D-3）
// 注：search/scene 推广已合并为「商品推广」（scenesType=9），对应命令已废弃删除。
import { Option } from 'commander';
import * as roi from '../promo/roi.js';
import { integerArg } from '../option-parsers.js';

export function register(program, wireAction) {
  const promo = program.command('promo').description('🚀 推广报表');
  wireAction(
    promo
      .command('roi')
      .description('推广 ROI 统计（按计划/商品/渠道维度）')
      .addOption(new Option('--by <dimension>', '分组维度').choices(['plan', 'sku', 'channel']).default('plan'))
      .option('--since <date>', '起始日期 YYYY-MM-DD')
      .option('--page <n>', '页码', integerArg(1), 1)
      .option('--size <n>', '每页数量', integerArg(1), 50)
      .option('--include-inactive', '包含已删除/暂停计划'),
    'promo.roi',
    roi.run
  );
}
