// diagnose 渲染层（design D-6 · R4）：render-only 助手与两个 dashboard 渲染器。
// 纯度约束：仅 import chalk / cli-table3，禁止 import shop.js/_runner/services（防注册期环依赖）。
import chalk from 'chalk';
import Table from 'cli-table3';

const ICON = {
  green: '\u{1F7E2}',
  yellow: '\u{1F7E1}',
  red: '\u{1F534}',
  partial: '⚪',
};

const COLOR_FN = {
  green: 'green',
  yellow: 'yellow',
  red: 'red',
  partial: 'gray',
};

function colorize(text, statusKey, useColor) {
  if (!useColor) return text;
  const fn = chalk[COLOR_FN[statusKey]];
  return typeof fn === 'function' ? fn(text) : text;
}

function scoreBar(score, width = 10) {
  if (typeof score !== 'number') return '░'.repeat(width);
  const clamped = Math.max(0, Math.min(100, score));
  const filled = Math.round((clamped / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function scoreText(score) {
  if (typeof score !== 'number') return ' --/100';
  return `${String(score).padStart(3, ' ')}/100`;
}

function statusOf(dim) {
  return dim?.status ?? 'partial';
}

function renderHeader(title, diag, useColor) {
  const status = statusOf(diag);
  const icon = ICON[status];
  const score = colorize(scoreText(diag.score), status, useColor);
  const bar = colorize(scoreBar(diag.score), status, useColor);
  const prefix = useColor ? chalk.bold(`诊断·${title}`) : `诊断·${title}`;
  return `${icon}  ${prefix}  ${score}  ${bar}`;
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
  const issueLines = renderIssues(diag?.issues, useColor);
  if (issueLines.length > 0) lines.push('', ...issueLines);
  const hintLines = renderHints(diag?.hints, useColor);
  if (hintLines.length > 0) lines.push('', ...hintLines);
  return lines.join('\n');
}

export function renderShopDashboard(envelope, { useColor }) {
  const diag = envelope.data;
  const lines = [renderHeader('shop', diag, useColor)];
  const table = new Table({
    head: ['维度', '状态', '分数', '分数条'],
    style: useColor ? undefined : { head: [], border: [] },
  });
  const DIMS = ['orders', 'inventory', 'promo', 'funnel'];
  for (const name of DIMS) {
    const sub = diag?.dimensions?.[name];
    if (!sub) {
      table.push([name, '–', '--/100', '░'.repeat(10)]);
      continue;
    }
    const s = statusOf(sub);
    table.push([
      name,
      ICON[s],
      colorize(scoreText(sub.score), s, useColor),
      colorize(scoreBar(sub.score), s, useColor),
    ]);
  }
  lines.push(table.toString());
  const issueLines = renderIssues(diag?.issues, useColor);
  if (issueLines.length > 0) lines.push('', ...issueLines);
  const hintLines = renderHints(diag?.hints, useColor);
  if (hintLines.length > 0) lines.push('', ...hintLines);
  return lines.join('\n');
}
