import chalk from 'chalk';
import Table from 'cli-table3';
import { withCommand } from '../_runner.js';
import { getOrderStatsView } from '../../services/orders.js';

function formatValue(value) {
  if (value == null) return '--';
  if (Array.isArray(value)) return value.length === 0 ? '无' : value.map(formatValue).join(' | ');
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length === 0 ? '无' : entries.map(([key, item]) => `${key}: ${formatValue(item)}`).join('；');
  }
  return String(value);
}

function tableStyle(useColor) {
  return useColor ? undefined : { head: [], border: [] };
}

function renderKeyValueTable(title, rows, useColor) {
  const table = new Table({ head: ['指标', '数值'], style: tableStyle(useColor) });
  for (const [label, value] of rows) table.push([label, formatValue(value)]);
  const heading = useColor ? chalk.bold(title) : title;
  return `${heading}\n${table.toString()}`;
}

function renderRegions(regions, useColor) {
  if (!regions?.items?.length) return '';
  const table = new Table({
    head: ['省份', '成团额(元)', '成团单数', '买家数', '客单价(元)', '笔单价(元)'],
    style: tableStyle(useColor),
  });
  for (const item of regions.items) {
    table.push([
      item.province, formatValue(item.confirmed_order_amount_yuan), formatValue(item.confirmed_order_count),
      formatValue(item.confirmed_buyer_count), formatValue(item.avg_buyer_amount_yuan), formatValue(item.avg_order_amount_yuan),
    ]);
  }
  const heading = `省级成团分布（${regions.caliber}）`;
  return `${useColor ? chalk.bold(heading) : heading}\n${table.toString()}`;
}

function renderHints(hints, useColor) {
  if (!Array.isArray(hints) || hints.length === 0) return [];
  const title = `Hints (${hints.length}):`;
  return [useColor ? chalk.bold(title) : title, ...hints.map((hint) => `  · ${hint}`)];
}

function renderOrderStats(envelope, { useColor }) {
  const data = envelope.data ?? {};
  const title = '订单统计';
  const lines = [useColor ? chalk.bold(title) : title];
  if (Array.isArray(data.headline)) lines.push(...data.headline.map((line) => `  ${line}`));

  if (data.remote) {
    lines.push('', renderKeyValueTable('平台订单计数', [
      ['待发货', data.remote.pending_ship_count],
      ['待发货超 12 小时', data.remote.pending_ship_over_12h_count],
      ['延迟发货', data.remote.delayed_ship_count],
      ['已发货待收货', data.remote.pending_receipt_count],
    ], useColor));
  }

  if (data.local) {
    lines.push('', renderKeyValueTable('本地样本统计', [
      ['样本订单数', data.local.order_count],
      ['状态分布', data.local.status_distribution],
      ['已发货样本数', data.local.ship_samples],
      ['发货时长 P50 (小时)', data.local.ship_p50_hours],
      ['发货时长 P95 (小时)', data.local.ship_p95_hours],
      ['退款成功单数', data.local.refund_count],
      ['售后处理中单数', data.local.after_sales_count],
      ['退款率 (%)', data.local.refund_rate_pct],
    ], useColor));
  }

  const regions = renderRegions(data.regions, useColor);
  if (regions) lines.push('', regions);

  const hintLines = renderHints(data.hints, useColor);
  if (hintLines.length > 0) lines.push('', ...hintLines);

  return lines.join('\n');
}

export const run = withCommand({
  name: 'orders.stats',
  needsAuth: true,
  needsMall: 'switch',
  render: renderOrderStats,
  async run(ctx) {
    const { size = 50, withRegions = false } = ctx.config;
    return getOrderStatsView(ctx.page, { size, withRegions: Boolean(withRegions) }, ctx);
  },
});
