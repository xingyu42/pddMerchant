#!/usr/bin/env node
/**
 * 一次性验证当前 scrapeSourceGoods() 的真实抓取结果。
 *
 * - 每次运行只调用一次 scrapeSourceGoods，不重试。
 * - 消费者认证文件不存在时，自动调用项目现有有头登录；存在时直接复用。
 * - 不进入 goods publish 服务，不创建草稿，不提交商品。
 * - 抓取阶段不修改全局 session health / scrape cooldown；自动登录沿用现有
 *   消费者登录语义，会保存新登录态并清除旧抓取冷却。
 * - 只输出规格、SKU、价格和库存的脱敏统计，不输出图片、Cookie 或代理节点。
 *
 * 用法：
 *   node scripts/validate-source-scrape-once.mjs --goods 447841256386
 *   node scripts/validate-source-scrape-once.mjs --goods 447841256386 --headed
 *   node scripts/validate-source-scrape-once.mjs --goods 447841256386 --direct
 *   node scripts/validate-source-scrape-once.mjs --goods 447841256386 --json
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  closeBrowser,
  createConsumerContext,
  launchBrowser,
} from '../src/adapter/browser.js';
import { scrapeSourceGoods } from '../src/adapter/goods-publish/source-scraper.js';
import {
  acquireQingguoProxyLease,
  readSourceProxyConfig,
} from '../src/adapter/goods-publish/qingguo-proxy.js';
import { CONSUMER_AUTH_STATE_PATH } from '../src/infra/paths.js';
import { TIMEOUTS } from '../src/infra/timeouts.js';
import { performConsumerHeadedLogin } from '../src/services/auth.js';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv() {
  const envPath = process.env.PDD_ENV_FILE || join(PROJECT_ROOT, '.env');
  if (!existsSync(envPath) || typeof process.loadEnvFile !== 'function') return;
  process.loadEnvFile(envPath);
}

function parseArgs(argv) {
  const args = {
    goodsId: null,
    headed: false,
    direct: false,
    simulate: true,
    json: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--goods') args.goodsId = argv[++index];
    else if (arg === '--headed') args.headed = true;
    else if (arg === '--direct') args.direct = true;
    else if (arg === '--no-simulate') args.simulate = false;
    else if (arg === '--json') args.json = true;
    else throw new Error(`未知参数: ${arg}`);
  }
  if (!/^\d+$/.test(String(args.goodsId ?? ''))) {
    const error = new Error('--goods 必须提供纯数字 goods_id');
    error.exitCode = 2;
    throw error;
  }
  return args;
}

async function resolveProxy(direct) {
  if (direct) return { proxy: null, provider: 'direct' };
  const config = readSourceProxyConfig();
  if (!config.enabled) return { proxy: null, provider: 'direct' };
  const lease = await acquireQingguoProxyLease(config);
  return {
    proxy: { server: lease.server },
    provider: lease.provider,
  };
}

async function ensureConsumerLogin(authStatePath) {
  if (existsSync(authStatePath)) {
    return { performed: false, mode: 'existing-auth-state', scrape_cooldown_reset: false };
  }

  const result = await performConsumerHeadedLogin({
    authStatePath,
    timeoutMs: TIMEOUTS.LOGIN_HEADED,
  });
  return {
    performed: true,
    mode: result.mode,
    trigger: 'auth-state-missing',
    scrape_cooldown_reset: true,
  };
}

const readOnlyHealth = {
  check() {},
  recordRisk() {},
  recordSuccess() {},
};

const readOnlyCooldown = {
  check() {},
  recordSuccess() {},
  recordSoftBlock() {
    return {
      cooldownTriggered: false,
      cooldownRemainingMs: 0,
      cooldownUntil: 0,
      consecutiveSoftBlock: 0,
    };
  },
};

function range(values) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return { min: null, max: null };
  return { min: Math.min(...finite), max: Math.max(...finite) };
}

function summarizeSuccess(goodsId, source, provider, login, elapsedMs) {
  const skus = Array.isArray(source.skus) ? source.skus : [];
  return {
    ok: true,
    goods_id: goodsId,
    source_route: 'scrapeSourceGoods',
    network_mode: provider,
    login,
    elapsed_ms: elapsedMs,
    title_present: Boolean(String(source.goodsName ?? '').trim()),
    category_present: Boolean(source.catID ?? source.catID3),
    carousel_count: Array.isArray(source.carousel) ? source.carousel.length : 0,
    dimensions: (source.skuDimensions ?? []).map((dimension) => ({
      name: dimension.name,
      value_count: Array.isArray(dimension.values) ? dimension.values.length : 0,
    })),
    sku_count: skus.length,
    group_price_cents: range(skus.map((sku) => sku.sourcePriceCents)),
    normal_price_cents: range(skus.map((sku) => sku.sourceNormalPriceCents)),
    stock: range(skus.map((sku) => sku.stock)),
    zero_stock_count: skus.filter((sku) => sku.stock === 0).length,
  };
}

function normalizeScrapeError(error, provider) {
  const detail = error?.detail && typeof error.detail === 'object' ? error.detail : {};
  if (error?.code) {
    return { code: error.code, message: error?.message ?? String(error), detail };
  }

  const rawMessage = error?.message ?? String(error);
  const browserError = /net::(ERR_[A-Z0-9_]+)/.exec(rawMessage)?.[1] ?? null;
  const navigationFailed = /page\.goto:|net::ERR_|TimeoutError|ETIMEDOUT|ECONNRESET|ECONNREFUSED/i
    .test(rawMessage);
  if (!navigationFailed) return { code: 'E_UNKNOWN', message: rawMessage, detail };

  const viaProxy = provider === 'qingguo';
  return {
    code: viaProxy ? 'E_PROXY_NETWORK' : 'E_NETWORK',
    message: viaProxy
      ? '青果代理未能加载源商品页，抓取尚未进入页面解析阶段'
      : '源商品页导航失败，抓取尚未进入页面解析阶段',
    detail: {
      ...detail,
      reason: 'source_navigation_failed',
      phase: 'source_navigation',
      browser_error: browserError,
      suggestion: viaProxy
        ? '本次代理节点未成功返回页面；重新运行会重新申请节点，但仍只抓取一次'
        : '检查当前网络后重试；本次未取得任何页面数据',
    },
  };
}

function summarizeError(goodsId, error, provider, login, elapsedMs) {
  const normalized = normalizeScrapeError(error, provider);
  const detail = normalized.detail;
  return {
    ok: false,
    goods_id: goodsId,
    source_route: 'scrapeSourceGoods',
    network_mode: provider,
    login,
    elapsed_ms: elapsedMs,
    error: {
      code: normalized.code,
      message: normalized.message,
      phase: detail.phase ?? null,
      reason: detail.reason ?? null,
      browser_error: detail.browser_error ?? null,
      suggestion: detail.suggestion ?? null,
      dimension_count: detail.dimension_count ?? detail.dimensionCount ?? null,
      sku_count: detail.sku_count ?? detail.skuCount ?? null,
      issues: detail.issues ?? detail.skuIssues ?? [],
      path: detail.path ?? null,
    },
  };
}

function networkLabel(provider) {
  return provider === 'qingguo' ? '青果代理' : '直连';
}

function formatPriceRange(priceRange) {
  if (priceRange.min == null || priceRange.max == null) return '未获取';
  const minimum = (priceRange.min / 100).toFixed(2);
  const maximum = (priceRange.max / 100).toFixed(2);
  return minimum === maximum ? `¥${minimum}` : `¥${minimum} ～ ¥${maximum}`;
}

function formatStockRange(stockRange) {
  if (stockRange.min == null || stockRange.max == null) return '未获取';
  return stockRange.min === stockRange.max
    ? `${stockRange.min} 件`
    : `${stockRange.min} ～ ${stockRange.max} 件`;
}

function formatHumanSuccess(result) {
  const dimensionLines = result.dimensions.length === 0
    ? ['  无规格维度（真实单 SKU 商品）']
    : result.dimensions.map((dimension) => `  - ${dimension.name}：${dimension.value_count} 个选项`);
  return [
    '源商品抓取验证：成功',
    `商品 ID：${result.goods_id}`,
    `消费者登录：${result.login.performed ? '认证文件不存在，已自动完成消费者登录' : '复用现有登录态'}`,
    `网络方式：${networkLabel(result.network_mode)}`,
    `耗时：${(result.elapsed_ms / 1000).toFixed(1)} 秒`,
    '',
    '基础信息',
    `  标题：${result.title_present ? '已获取' : '缺失'}`,
    `  类目：${result.category_present ? '已获取' : '缺失'}`,
    `  轮播图：${result.carousel_count} 张`,
    '',
    `规格与 SKU（${result.dimensions.length} 个维度）`,
    ...dimensionLines,
    `  SKU 总数：${result.sku_count} 个`,
    '',
    '价格与库存',
    `  拼单价：${formatPriceRange(result.group_price_cents)}`,
    `  单买价：${formatPriceRange(result.normal_price_cents)}`,
    `  库存范围：${formatStockRange(result.stock)}`,
    `  零库存 SKU：${result.zero_stock_count} 个`,
    '',
    '结论：结构化 SKU 数据完整，当前抓取逻辑验证通过。',
    '安全边界：本次未创建草稿、未提交商品；仅在认证文件不存在时由现有登录服务写入登录态并清除旧抓取冷却。',
  ].join('\n');
}

function formatHumanError(result) {
  const error = result.error;
  const lines = [
    '源商品抓取验证：失败',
    `商品 ID：${result.goods_id}`,
    `消费者登录：${result.login.performed ? '认证文件不存在，已自动完成消费者登录' : '复用现有登录态'}`,
    `网络方式：${networkLabel(result.network_mode)}`,
    `耗时：${(result.elapsed_ms / 1000).toFixed(1)} 秒`,
    '',
    '失败信息',
    `  错误代码：${error.code}`,
    `  错误说明：${error.message}`,
  ];
  if (error.reason) lines.push(`  判定原因：${error.reason}`);
  if (error.phase === 'source_navigation') {
    lines.push('  失败阶段：源商品页导航（尚未进入页面解析）');
  }
  if (error.browser_error) lines.push(`  浏览器信号：${error.browser_error}`);
  if (error.dimension_count != null) lines.push(`  已识别规格维度：${error.dimension_count} 个`);
  if (error.sku_count != null) lines.push(`  已识别 SKU：${error.sku_count} 个`);
  if (Array.isArray(error.issues) && error.issues.length > 0) {
    lines.push(`  数据问题：${error.issues.join('、')}`);
  }
  if (error.path) lines.push(`  页面路径：${error.path}`);
  if (error.suggestion) lines.push(`  处理建议：${error.suggestion}`);
  lines.push(
    '',
    '结论：当前抓取结果不完整，不能据此创建草稿。',
    '安全边界：本次未创建草稿、未提交商品；仅在认证文件不存在时由现有登录服务写入登录态并清除旧抓取冷却。',
  );
  return lines.join('\n');
}

function emitResult(result, { json }) {
  const output = json
    ? JSON.stringify(result)
    : (result.ok ? formatHumanSuccess(result) : formatHumanError(result));
  process.stdout.write(`${output}\n`);
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv);
  if (!args.simulate) process.env.PDD_SCRAPE_SIMULATE = '0';

  const authStatePath = process.env.PDD_CONSUMER_AUTH_STATE_PATH || CONSUMER_AUTH_STATE_PATH;
  const login = await ensureConsumerLogin(authStatePath);

  let launched = null;
  let consumer = null;
  let provider = args.direct ? 'direct' : 'unresolved';
  const startedAt = Date.now();
  try {
    const proxyConfig = await resolveProxy(args.direct);
    provider = proxyConfig.provider;
    launched = await launchBrowser({ headed: args.headed });
    await launched.context.close();
    consumer = await createConsumerContext(launched.browser, {
      storageStatePath: authStatePath,
      ...(proxyConfig.proxy ? { proxy: proxyConfig.proxy } : {}),
    });

    try {
      const source = await scrapeSourceGoods(consumer.page, args.goodsId, {
        sessionHealth: readOnlyHealth,
        scrapeCooldown: readOnlyCooldown,
      });
      emitResult(summarizeSuccess(args.goodsId, source, provider, login, Date.now() - startedAt), args);
    } catch (error) {
      emitResult(summarizeError(args.goodsId, error, provider, login, Date.now() - startedAt), args);
      process.exitCode = 1;
    }
  } finally {
    try { await consumer?.close(); } catch { /* ignore */ }
    try { await closeBrowser(launched?.browser); } catch { /* ignore */ }
  }
}

main().catch((error) => {
  process.stderr.write(`[validate-source-scrape-once] ${error?.message ?? error}\n`);
  process.exitCode = error?.exitCode ?? 1;
});
