import Table from 'cli-table3';
import { withCommand } from '../_runner.js';
import { renderSingleDashboard } from './_render.js';
import { getShopExperienceView } from '../../services/experience.js';

export function renderExperience(envelope, options) {
  const view = envelope.data;
  const dashboard = renderSingleDashboard({ ...envelope, command: 'diagnose.店铺综合体验星级' }, options);
  const table = new Table({ head: ['维度', '指标', '数值', '单位', '下一星级门槛', '达标状态'],
    style: options.useColor ? undefined : { head: [], border: [] } });
  for (const indicator of view.indicators) {
    table.push([indicator.dimension, indicator.name, indicator.value ?? '--', indicator.unit,
      indicator.next_star_threshold ?? '--', indicator.next_star_status ?? '--']);
  }
  const snapshot = view.snapshot;
  const date = `统计日期 ${snapshot.stat_date ?? '--'}，行业 ${snapshot.industry ?? '--'}`;
  const plan = view.consumer_experience_plan;
  const enabled = plan.enabled == null ? '--' : (plan.enabled ? '已开通' : '未开通');
  const required = plan.required == null ? '--' : (plan.required ? '是' : '否');
  const service = `消费者体验提升计划：${enabled}，要求开通：${required}，${plan.next_star_status ?? '--'}`;
  const trend = view.trend;
  const range = trend ? `趋势 ${trend.start_date} 至 ${trend.end_date}，有数据 ${trend.items.length} 天` : '趋势数据缺失';
  return [dashboard, date, table.toString(), service, range].join('\n');
}

export const run = withCommand({
  name: 'diagnose.experience', needsAuth: true, needsMall: 'switch', render: renderExperience,
  async run(ctx) {
    return getShopExperienceView(ctx, { days: ctx.config?.days });
  },
});

export default run;
