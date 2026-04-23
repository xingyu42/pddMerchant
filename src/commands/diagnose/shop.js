import chalk from 'chalk';
import Table from 'cli-table3';
import { launchBrowser, closeBrowser } from '../../adapter/browser.js';
import { isAuthValid } from '../../adapter/auth-state.js';
import { currentMall, switchTo } from '../../adapter/mall-switcher.js';
import { buildEnvelope } from '../../infra/output.js';
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { listOrders, getOrderStats, computeOrderStats } from '../../services/orders.js';
import { listGoods } from '../../services/goods.js';
import { getPromoReport } from '../../services/promo.js';
import { diagnoseShop } from '../../services/diagnose/index.js';
import { collectOrdersForStaleAnalysis } from '../../services/diagnose/orders-collector.js';
import { AUTH_STATE_PATH as DEFAULT_AUTH_STATE_PATH } from '../../infra/paths.js';

const ICON = {
  green: '🟢',
  yellow: '🟡',
  red: '🔴',
  partial: '⚪',
};

const COLOR_FN = {
  green: 'green',
  yellow: 'yellow',
  red: 'red',
  partial: 'gray',
};

function shouldUseColor({ noColor, tty }) {
  if (noColor) return false;
  if (process.env.NO_COLOR) return false;
  return Boolean(tty ?? process.stdout.isTTY);
}

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

function renderSingleDashboard(commandName, diag, useColor) {
  const title = String(commandName).replace(/^diagnose\./, '');
  const lines = [renderHeader(title, diag, useColor)];
  const issueLines = renderIssues(diag?.issues, useColor);
  if (issueLines.length > 0) lines.push('', ...issueLines);
  const hintLines = renderHints(diag?.hints, useColor);
  if (hintLines.length > 0) lines.push('', ...hintLines);
  return lines.join('\n');
}

function renderShopDashboard(diag, useColor) {
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

function emitDiagnostic(envelope, { json, isShop, noColor = false }) {
  if (json) {
    process.stdout.write(JSON.stringify(envelope) + '\n');
    if (envelope.error) {
      process.stderr.write(`[${envelope.error.code}] ${envelope.error.message}\n`);
      if (envelope.error.hint) process.stderr.write(`hint: ${envelope.error.hint}\n`);
    }
    return envelope;
  }
  const useColor = shouldUseColor({ noColor, tty: process.stdout.isTTY });
  if (envelope.ok) {
    const body = isShop
      ? renderShopDashboard(envelope.data, useColor)
      : renderSingleDashboard(envelope.command, envelope.data, useColor);
    process.stdout.write(body + '\n');
  } else {
    const header = `FAIL  ${envelope.command}`;
    process.stdout.write((useColor ? chalk.red(header) : header) + '\n');
    const e = envelope.error;
    if (e) {
      const el = `[${e.code || 'E_GENERAL'}] ${e.message || ''}`;
      process.stderr.write((useColor ? chalk.red(el) : el) + '\n');
      if (e.hint) {
        const hl = `hint: ${e.hint}`;
        process.stderr.write((useColor ? chalk.yellow(hl) : hl) + '\n');
      }
    }
  }
  return envelope;
}

export async function runDiagnoseCommand({ command, options = {}, fetchAndScore, isShop = false }) {
  const {
    json = false,
    authStatePath = DEFAULT_AUTH_STATE_PATH,
    mall,
    headed = false,
    noColor = false,
  } = options;

  const startedAt = Date.now();
  let browser = null;

  try {
    const launched = await launchBrowser({
      headed,
      storageStatePath: authStatePath,
    });
    browser = launched.browser;
    const { page } = launched;

    const valid = await isAuthValid(page);
    if (!valid) {
      throw new PddCliError({
        code: 'E_AUTH_EXPIRED',
        message: '登录态已过期或缺失',
        hint: '执行 pdd login 重新登录',
        exitCode: ExitCodes.AUTH,
      });
    }

    let mallCtx = null;
    if (mall) {
      mallCtx = await switchTo(page, mall);
    } else {
      mallCtx = await currentMall(page).catch(() => null);
    }

    const diagnostic = await fetchAndScore(page, { mallId: mallCtx?.id ?? null });

    const envelope = buildEnvelope({
      ok: true,
      command,
      data: diagnostic,
      meta: {
        latency_ms: Date.now() - startedAt,
        mall: mallCtx?.id ?? null,
      },
    });
    return emitDiagnostic(envelope, { json, isShop, noColor });
  } catch (err) {
    const isCli = err instanceof PddCliError;
    const envelope = buildEnvelope({
      ok: false,
      command,
      error: {
        code: isCli ? err.code : 'E_GENERAL',
        message: isCli ? err.message : err?.message || '未知错误',
        hint: isCli ? err.hint : '',
      },
      meta: { latency_ms: Date.now() - startedAt },
    });
    return emitDiagnostic(envelope, { json, isShop, noColor });
  } finally {
    await closeBrowser(browser);
  }
}

async function collectOrdersInput(page, ctx) {
  // getOrderStats 与 listOrders 都 nav 到 /orders/list，同一 page 上二次 goto 在真实 PDD
  // 环境不稳定（后端缓存/节流导致 XHR 不再 fire）；拆独立 page 并发。
  const hasContext = typeof page?.context === 'function';
  const statsPage = hasContext ? await page.context().newPage() : page;
  try {
    const [statsResult, listResult] = await Promise.allSettled([
      getOrderStats(statsPage, ctx),
      listOrders(page, { page: 1, size: 50 }, ctx),
    ]);
    const stats = statsResult.status === 'fulfilled' ? statsResult.value : null;
    const listStats = listResult.status === 'fulfilled'
      ? computeOrderStats(listResult.value?.orders ?? [])
      : null;
    if (stats == null && listStats == null) return undefined;
    return { stats, listStats };
  } finally {
    if (hasContext && statsPage !== page) await statsPage.close().catch(() => {});
  }
}

async function collectGoodsInput(page, ctx) {
  let goods;
  let goodsTotal;
  try {
    const result = await listGoods(page, { page: 1, size: 100 }, ctx);
    goods = result?.goods ?? [];
    const reported = Number(result?.total);
    goodsTotal = Number.isFinite(reported) && reported > 0 ? reported : goods.length;
  } catch {
    return undefined;
  }
  let orders30d = null;
  let truncated = false;
  let ratelimited = false;
  try {
    const collected = await collectOrdersForStaleAnalysis(page, ctx);
    orders30d = collected.orders;
    truncated = collected.truncated;
    ratelimited = collected.ratelimited;
  } catch {
    // collector 抛异常视为 stale 数据缺失，scoreInventoryHealth 自动走 missing 分支
  }
  return { goods, goodsTotal, orders30d, truncated, ratelimited };
}

async function collectPromoInput(page, ctx) {
  try {
    const report = await getPromoReport(page, { mallId: ctx?.mallId });
    return { totals: report?.totals ?? null };
  } catch {
    return undefined;
  }
}

export async function run(options = {}) {
  return runDiagnoseCommand({
    command: 'diagnose.shop',
    options,
    isShop: true,
    fetchAndScore: async (page, ctx) => {
      // Per-dim 独立 page：3 维度并发采集，共享 context 里的登录态，避免 page.goto 互相覆盖。
      // Mock 模式下 page 无 context()，所有 collect* 走 fixture 短路，共享 page 无竞态。
      const hasContext = typeof page?.context === 'function';
      const goodsPage = hasContext ? await page.context().newPage() : page;
      const promoPage = hasContext ? await page.context().newPage() : page;
      try {
        const [orders, goods, promo] = await Promise.all([
          collectOrdersInput(page, ctx),
          collectGoodsInput(goodsPage, ctx),
          collectPromoInput(promoPage, ctx),
        ]);
        return diagnoseShop({
          orders,
          goods,
          promo,
          funnel: orders?.listStats ? { orderStats: orders.listStats, windowDays: 7 } : undefined,
        });
      } finally {
        if (hasContext) {
          await goodsPage.close().catch(() => {});
          await promoPage.close().catch(() => {});
        }
      }
    },
  });
}

export default run;
export {
  renderSingleDashboard,
  renderShopDashboard,
  emitDiagnostic,
  DEFAULT_AUTH_STATE_PATH,
  collectOrdersInput,
  collectGoodsInput,
  collectPromoInput,
};
