#!/usr/bin/env node
/**
 * 有头打开消费端首页 — 复用青果代理
 *
 * 用途：以 patchright 有头模式打开消费端（yangkeduo）首页，出口 IP 走青果代理
 *      （与 goods publish 生产路径同一套 readSourceProxyConfig + acquireQingguoProxyLease
 *      + createConsumerContext({ proxy: { server } }) ），便于肉眼观察真实渲染 / 风控表现。
 *      仅进入首页，不打开任何商品页。
 *
 * 与 scripts/probe-soft-risk.mjs 的区别：本脚本不抓取、不判风控，只导航到首页后挂起，
 * 让你手动交互；关闭浏览器窗口或 Ctrl-C 即退出。
 *
 * ⚠️ 复用与不回退：青果代理为 IP 白名单鉴权，lease 仅返回 server（无账密）。
 *      若 PDD_SOURCE_PROXY_PROVIDER 未配置，则直连（不经代理）。
 *      获取 lease 失败不会静默回退直连，直接报错退出（与生产语义一致）。
 *
 * 用法：
 *   PDD_SOURCE_PROXY_PROVIDER=qingguo PDD_QINGGUO_AUTH_KEY=xxx \
 *     node scripts/open-consumer-proxied.mjs
 *   选项：
 *     --direct          强制直连（忽略代理配置，用于对照观察）
 *     --keep <sec>      自动关闭前保持打开的秒数，默认 600（0=直连时一直挂起）
 *                       代理模式不会超过当前租约的剩余有效期
 *   环境：
 *     消费端登录态可选（data/consumer-auth-state.json 或 PDD_CONSUMER_AUTH_STATE_PATH）
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  launchBrowser,
  createConsumerContext,
  closeBrowser,
} from '../src/adapter/browser.js';
import {
  readSourceProxyConfig,
  acquireQingguoProxyLease,
} from '../src/adapter/goods-publish/qingguo-proxy.js';
import { CONSUMER_AUTH_STATE_PATH } from '../src/infra/paths.js';

// 独立脚本不走 CLI 入口，需自行加载项目根 .env（生产 CLI 靠 shell export）。
// Node >=20.6 可原生加载 .env；Node 18 没有此 API，此时继续使用 shell 已导出的变量。
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function loadDotEnv() {
  const envPath = process.env.PDD_ENV_FILE || join(PROJECT_ROOT, '.env');
  if (!existsSync(envPath)) {
    console.error('[open] 未找到项目 .env，仅使用已导出的环境变量');
    return;
  }
  if (typeof process.loadEnvFile !== 'function') {
    console.error('[open] 当前 Node 版本不支持自动加载 .env，仅使用已导出的环境变量');
    return;
  }
  try {
    process.loadEnvFile(envPath);
    console.error('[open] 已加载项目 .env');
  } catch (err) {
    console.error(`[open] 加载 .env 失败: ${err?.message ?? err}`);
  }
}

const CONSUMER_HOME_URL = 'https://mobile.yangkeduo.com/';

function parseArgs(argv) {
  const a = { direct: false, keep: 600 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--direct') a.direct = true;
    else if (k === '--keep') a.keep = Number(argv[++i]);
  }
  return a;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resolveProxy(direct) {
  if (direct) {
    console.error('[open] --direct：强制直连，忽略代理配置');
    return null;
  }
  const config = readSourceProxyConfig(); // provider 校验 + 配置完整性，失败即抛
  if (!config.enabled) {
    console.error('[open] 未配置 PDD_SOURCE_PROXY_PROVIDER：直连');
    return null;
  }
  const lease = await acquireQingguoProxyLease(config);
  const remainingSec = Math.max(0, Math.floor((lease.expiresAt - Date.now()) / 1000));
  console.error(
    `[open] 青果代理已获取: area=${lease.area ?? '-'} ` +
    `isp=${lease.isp ?? '-'} 剩余=${remainingSec}s reqIdHash=${lease.requestIdHash ?? '-'}`,
  );
  return {
    contextProxy: { server: lease.server },
    expiresAt: lease.expiresAt,
  };
}

async function main() {
  loadDotEnv(); // 必须在 readSourceProxyConfig 读取环境变量前
  const args = parseArgs(process.argv);
  if (!Number.isFinite(args.keep) || args.keep < 0) {
    console.error(`[open] --keep 必须为 >= 0 的数字（收到: ${args.keep}）`);
    process.exit(2);
  }

  const proxyLease = await resolveProxy(args.direct);
  const proxy = proxyLease?.contextProxy ?? null;

  // launchBrowser 只负责建立统一的 Browser RuntimeProfile。关闭它的初始空 Context 后，
  // 通过生产路径同款 createConsumerContext 创建仅消费端使用的代理 Context。
  const { browser, context: bootstrapContext } = await launchBrowser({ headed: true });
  let consumer = null;
  let page = null;

  let interrupted = false;
  let stopReason = null;
  const stop = (reason) => () => { interrupted = true; stopReason ??= reason; };
  const onSigint = stop('sigint');

  try {
    await bootstrapContext.close();
    consumer = await createConsumerContext(browser, {
      storageStatePath: process.env.PDD_CONSUMER_AUTH_STATE_PATH || CONSUMER_AUTH_STATE_PATH,
      ...(proxy ? { proxy } : {}),
    });
    page = consumer.page;

    process.once('SIGINT', onSigint);
    // 关闭窗口即退出：page.close（关标签页）与 browser.disconnected（关整个窗口）均触发
    page.once('close', stop('page-close'));
    browser.once('disconnected', stop('browser-disconnected'));

    console.error(`[open] 导航首页: ${CONSUMER_HOME_URL}`);
    await page.goto(CONSUMER_HOME_URL, { waitUntil: 'domcontentloaded' });
    // 挂起：代理模式以租约的绝对截止时间为硬上限，导航耗时也计入租约。
    const keepDeadline = args.keep === 0 ? Infinity : Date.now() + args.keep * 1000;
    const deadline = proxyLease
      ? Math.min(keepDeadline, proxyLease.expiresAt)
      : keepDeadline;
    const effectiveKeepSec = Number.isFinite(deadline)
      ? Math.max(0, Math.floor((deadline - Date.now()) / 1000))
      : null;
    console.error(
      `[open] 首页已打开（${proxy ? '经青果代理' : '直连'}）。` +
      (effectiveKeepSec == null
        ? ' 挂起中，关闭窗口或 Ctrl-C 退出。'
        : ` ${effectiveKeepSec}s 后自动关闭，或关闭窗口/Ctrl-C 提前退出。`),
    );

    while (!interrupted && Date.now() < deadline) {
      await sleep(250);
    }
    if (!interrupted) {
      stopReason = proxyLease && proxyLease.expiresAt <= keepDeadline
        ? 'proxy-expired'
        : 'timeout';
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
    try { await consumer?.close(); } catch { /* ignore */ }
    try { await closeBrowser(browser); } catch { /* ignore */ } // 关 browser 会级联关掉其 context/page
    console.error(`[open] 已关闭浏览器（原因: ${stopReason ?? 'timeout'}）`);
  }
}

main().catch((err) => {
  console.error('[open] fatal:', err?.code ? `${err.code} ${err.message}` : (err?.stack || err?.message || err));
  process.exit(1);
});
