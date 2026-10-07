// Render factual measurements and availability; no operating assessments.
import chalk from 'chalk';
import Table from 'cli-table3';

// v2：status 已是中文标签（数据完整 / 数据不完整），维度名按标签显示
const TITLE_LABEL = { shop: '店铺', orders: '订单', inventory: '库存', promo: '推广', funnel: '履约' };

function renderHeader(title, diag, useColor) {
  const text = `统计·${TITLE_LABEL[title] ?? title} [${diag?.status ?? '数据不完整'}]`;
  return useColor ? chalk.bold(text) : text;
}

function renderHeadline(diag) {
  return Array.isArray(diag?.headline) ? diag.headline.map((line) => `  ${line}`) : [];
}

// 嵌套值展开为可读文本（不输出整段 JSON）：对象 → 「键: 值」以「；」连接，数组 → 元素以「 | 」连接
function formatValue(value) {
  if (value == null) return '--';
  if (Array.isArray(value)) return value.length === 0 ? '无' : value.map(formatValue).join(' | ');
  if (typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => `${key}: ${formatValue(item)}`).join('；');
  }
  return String(value);
}

function renderDetails(detail, useColor) {
  if (!detail || Object.keys(detail).length === 0) return '';
  const table = new Table({
    head: ['指标', '数值'],
    style: useColor ? undefined : { head: [], border: [] },
  });
  for (const [key, value] of Object.entries(detail)) table.push([key, formatValue(value)]);
  return table.toString();
}

function renderIssues(issues, useColor) {
  const out = [];
  if (!Array.isArray(issues) || issues.length === 0) return out;
  const title = `Issues (${issues.length}):`;
  out.push(useColor ? chalk.bold(title) : title);
  for (const i of issues) {
    if (typeof i === 'string') out.push(`  · ${i}`);
    else if (i && typeof i === 'object') out.push(`  · [${i.dimension || '?'}] ${i.message || ''}`);
  }
  return out;
}

function renderHints(hints, useColor) {
  const out = [];
  if (!Array.isArray(hints) || hints.length === 0) return out;
  const title = `Hints (${hints.length}):`;
  out.push(useColor ? chalk.bold(title) : title);
  for (const h of hints) {
    if (typeof h === 'string') out.push(`  · ${h}`);
    else if (h && typeof h === 'object') out.push(`  · [${h.dimension || '?'}] ${h.message || ''}`);
  }
  return out;
}

export function renderSingleDashboard(envelope, { useColor }) {
  const diag = envelope.data;
  const title = String(envelope.command).replace(/^diagnose\./, '');
  const lines = [renderHeader(title, diag, useColor), ...renderHeadline(diag)];
  const details = renderDetails(diag?.detail, useColor);
  if (details) lines.push('', details);
  const issueLines = renderIssues(diag?.issues, useColor);
  if (issueLines.length > 0) lines.push('', ...issueLines);
  const hintLines = renderHints(diag?.hints, useColor);
  if (hintLines.length > 0) lines.push('', ...hintLines);
  return lines.join('\n');
}

export function renderShopDashboard(envelope, { useColor }) {
  const diag = envelope.data;
  const lines = [renderHeader('shop', diag, useColor), ...renderHeadline(diag)];
  const DIMS = ['orders', 'inventory', 'promo', 'funnel'];
  for (const name of DIMS) {
    const sub = diag?.dimensions?.[name];
    lines.push('', renderHeader(name, sub, useColor), ...renderHeadline(sub));
    const details = renderDetails(sub?.detail, useColor);
    if (details) lines.push(details);
  }
  if (diag?.compare) lines.push('', renderComparison(diag.compare, useColor));
  const issueLines = renderIssues(diag?.issues, useColor);
  if (issueLines.length > 0) lines.push('', ...issueLines);
  const hintLines = renderHints(diag?.hints, useColor);
  if (hintLines.length > 0) lines.push('', ...hintLines);
  return lines.join('\n');
}

function renderComparison(comparison, useColor) {
  const table = new Table({
    head: ['指标', '当前', '上期', '变化', '变化 %', '说明'],
    style: useColor ? undefined : { head: [], border: [] },
  });
  for (const [dimension, value] of Object.entries(comparison.dimensions ?? {})) {
    for (const [metric, values] of Object.entries(value.metrics ?? {})) {
      table.push([
        `${dimension}.${metric}`, formatValue(values.current), formatValue(values.previous),
        formatValue(values.delta), formatValue(values.delta_pct), values.note ?? '',
      ]);
    }
  }
  const cur = comparison.current_window;
  const prev = comparison.previous_window;
  const range = cur && prev ? `（本期 ${cur.start_date}~${cur.end_date}，上期 ${prev.start_date}~${prev.end_date}）` : '';
  return `数值环比 [${comparison.status ?? ''}]${range}\n${table.toString()}`;
}
