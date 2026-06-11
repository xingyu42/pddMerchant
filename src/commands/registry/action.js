// 🎯 Action 分组注册（design D-3）
import * as plan from '../action/plan.js';

export function register(program, wireAction) {
  const action = program.command('action').description('🎯 运营动作');
  wireAction(
    action
      .command('plan')
      .description('生成优先级运营动作清单')
      .option('--days <n>', '诊断窗口天数', (v) => Number(v), 7)
      .option('--compare', '包含环比趋势')
      .option('--limit <n>', '最大动作数', (v) => Number(v), 10)
      .option('--break-even <n>', '推广保本 ROI 阈值', (v) => Number(v), 1.0)
      .option('--no-promo', '跳过推广 ROI')
      .option('--no-segment', '跳过商品分层'),
    'action.plan',
    plan.run
  );
}
