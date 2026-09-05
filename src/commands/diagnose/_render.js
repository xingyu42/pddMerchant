// Render factual measurements and availability; no operating assessments.
import chalk from 'chalk';
import Table from 'cli-table3';

function renderHeader(title, diag, useColor) {
  const label = diag?.status === 'full' ? '数据可用' : '数据不完整';
  const text = `统计·${title} [${label}]`;
  return useColor ? chalk.bold(text) : text;
}

function formatValue(value) {
  if (value == null) return '--';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
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
  const lines = [renderHeader(title, diag, useColor)];
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
  const lines = [renderHeader('shop', diag, useColor)];
  const DIMS = ['orders', 'inventory', 'promo', 'funnel'];
  for (const name of DIMS) {
    const sub = diag?.dimensions?.[name];
    lines.push('', renderHeader(name, sub, useColor));
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
  return `数值环比\n${table.toString()}`;
}
