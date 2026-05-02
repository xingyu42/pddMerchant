import chalk from 'chalk';
import Table from 'cli-table3';
import { withCommand } from '../../infra/command-runner.js';
import { listOrders, getOrderStats, computeOrderStats } from '../../services/orders.js';
import { getPromoReport } from '../../services/promo.js';
import { diagnoseShop } from '../../services/diagnose/index.js';
import { collectOrdersForStaleAnalysis } from '../../services/diagnose/orders-collector.js';
import { collectAllGoods } from '../../services/diagnose/goods-collector.js';
import { resolveCompareWindows, compareShopDiagnosis } from '../../services/diagnose/trend-compare.js';

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

export async function collectOrdersInput(page, ctx, { since, until, windowDays = 7 } = {}) {
  const hasContext = typeof page?.context === 'function';
  const statsPage = hasContext ? await page.context().newPage() : page;
  const nowSec = until ?? Math.floor(Date.now() / 1000);
  const sinceSec = since ?? (nowSec - windowDays * 86400);
  try {
    const [statsResult, listResult] = await Promise.allSettled([
      getOrderStats(statsPage, ctx),
      listOrders(page, { page: 1, size: 50, since: sinceSec, until: nowSec }, ctx),
    ]);
    const stats = statsResult.status === 'fulfilled' ? statsResult.value : null;
    const listStats = listResult.status === 'fulfilled'
      ? computeOrderStats(listResult.value?.orders ?? [])
      : null;
    if (stats == null && listStats == null) return undefined;
    return { stats, listStats, windowDays };
  } finally {
    if (hasContext && statsPage !== page) await statsPage.close().catch(() => {});
  }
}

export async function collectGoodsInput(page, ctx) {
  let goods;
  let goodsTotal;
  let goodsScanTruncated = false;
  let goodsScanRateLimited = false;
  try {
    const collected = await collectAllGoods(page, ctx);
    goods = collected.goods ?? [];
    goodsScanTruncated = collected.truncated;
    goodsScanRateLimited = collected.ratelimited;
    const reported = Number(collected.total);
    goodsTotal = Number.isFinite(reported) && reported > 0 ? reported : goods.length;
  } catch {
    return undefined;
  }
  if (goods.length === 0 && !goodsScanRateLimited) return undefined;
  let orders30d = null;
  let truncated = false;
  let ratelimited = false;
  try {
    const collected = await collectOrdersForStaleAnalysis(page, ctx);
    orders30d = collected.orders;
    truncated = collected.truncated;
    ratelimited = collected.ratelimited;
  } catch {
    // stale data missing — scoreInventoryHealth handles missing branch
  }
  return { goods, goodsTotal, goodsScanTruncated, goodsScanRateLimited, orders30d, truncated, ratelimited };
}

export async function collectPromoInput(page, ctx, { since, until } = {}) {
  try {
    const params = {};
    if (since) params.since = since instanceof Date ? since : new Date(since * 1000);
    if (until) params.until = until instanceof Date ? until : new Date(until * 1000);
    const report = await getPromoReport(page, params, ctx);
    return { totals: report?.totals ?? null };
  } catch {
    return undefined;
  }
}

async function collectDiagnosis(page, ctx, { since, until, windowDays } = {}) {
  const hasContext = typeof page?.context === 'function';
  const goodsPage = hasContext ? await page.context().newPage() : page;
  const promoPage = hasContext ? await page.context().newPage() : page;
  try {
    const [orders, goods, promo] = await Promise.all([
      collectOrdersInput(page, ctx, { since, until, windowDays }),
      collectGoodsInput(goodsPage, ctx),
      collectPromoInput(promoPage, ctx, { since, until }),
    ]);
    return diagnoseShop({
      orders,
      goods,
      promo,
      funnel: orders?.listStats ? { orderStats: orders.listStats, windowDays: orders.windowDays ?? windowDays ?? 7 } : undefined,
    });
  } finally {
    if (hasContext) {
      await goodsPage.close().catch(() => {});
      await promoPage.close().catch(() => {});
    }
  }
}

export const run = withCommand({
  name: 'diagnose.shop',
  needsAuth: true,
  needsMall: 'switch',
  render: renderShopDashboard,
  async run(ctx) {
    const page = ctx.page;
    const compare = ctx.config.compare ?? false;
    const days = ctx.config.days ?? 7;

    if (!compare) {
      return collectDiagnosis(page, ctx, { windowDays: days });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const windows = resolveCompareWindows({ nowSec, days });

    const [currentResult, previousResult] = await Promise.allSettled([
      collectDiagnosis(page, ctx, {
        since: windows.current.since,
        until: windows.current.until,
        windowDays: days,
      }),
      collectDiagnosis(page, ctx, {
        since: windows.previous.since,
        until: windows.previous.until,
        windowDays: days,
      }),
    ]);

    const current = currentResult.status === 'fulfilled' ? currentResult.value : null;
    const previous = previousResult.status === 'fulfilled' ? previousResult.value : null;

    if (!current) return { score: null, status: 'partial', dimensions: {}, issues: [], hints: [] };

    const comparison = compareShopDiagnosis({ current, previous });

    return {
      ...current,
      compare: {
        current_window: windows.current,
        previous_window: windows.previous,
        status: previous ? 'full' : 'partial',
        ...comparison,
      },
    };
  },
});

export default run;
