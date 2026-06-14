#!/usr/bin/env node
/**
 * 软风控脱敏 — 限流间隔探测脚本
 *
 * 用途：对消费端商品页按可配间隔持续发起抓取，探测 PDD 触发"软风控脱敏"
 *      （价格/SKU 不可见）所需的请求频率，并验证生产路径 scrapeSourceGoods
 *      能在真实脱敏页上抛出 E_RISK_CONTROL_SOFT。
 *
 * ⚠️ 风险：高频访问消费端可能导致账号被风控/标记。脚本默认渐进、低频，
 *         并在首次检测到脱敏时立即停止。请仅对自有账号、按需运行。
 *
 * 用法：
 *   node scripts/probe-soft-risk.mjs --interval 1500 --max 30 \
 *        --goods 935700288787,918867803697
 *   环境：消费端登录态须存在（data/consumer-auth-state.json 或 PDD_CONSUMER_AUTH_STATE_PATH）
 *   选项：
 *     --interval <ms>  两次请求间隔，默认 1500
 *     --max <n>        最大请求数（安全上限），默认 30
 *     --goods <ids>    逗号分隔的 goods_id，轮询使用
 *     --headed         有头模式（便于肉眼观察脱敏页）
 *     --no-simulate    关闭人为浏览模拟（请求更快，但更易被风控）
 */

import { launchBrowser, createConsumerContext, closeBrowser } from '../src/adapter/browser.js';
import { scrapeSourceGoods } from '../src/adapter/goods-publish/source-scraper.js';
import { CONSUMER_AUTH_STATE_PATH } from '../src/infra/paths.js';

function parseArgs(argv) {
  const a = { interval: 1500, max: 30, goods: ['935700288787', '918867803697'], headed: false, simulate: true };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--interval') a.interval = Number(argv[++i]);
    else if (k === '--max') a.max = Number(argv[++i]);
    else if (k === '--goods') a.goods = String(argv[++i]).split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--headed') a.headed = true;
    else if (k === '--no-simulate') a.simulate = false;
  }
  return a;
}

const MIN_INTERVAL_MS = 300; // 安全下限：避免误传导致高频轰炸账号
const MAX_REQUESTS_CAP = 200;

function validateArgs(a) {
  const errs = [];
  if (!Number.isFinite(a.interval) || a.interval < MIN_INTERVAL_MS) {
    errs.push(`--interval 必须为 >= ${MIN_INTERVAL_MS} 的数字（收到: ${a.interval}）`);
  }
  if (!Number.isInteger(a.max) || a.max < 1 || a.max > MAX_REQUESTS_CAP) {
    errs.push(`--max 必须为 1..${MAX_REQUESTS_CAP} 的整数（收到: ${a.max}）`);
  }
  if (!Array.isArray(a.goods) || a.goods.length === 0 || !a.goods.every((g) => /^\d+$/.test(g))) {
    errs.push(`--goods 必须为非空、全数字的 goods_id 列表（收到: ${JSON.stringify(a.goods)}）`);
  }
  return errs;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 无操作 session-health：让脚本纯观察 PDD 行为，不被自身熔断提前中止
const noopHealth = { check() {}, recordSuccess() {}, recordRisk() {} };

async function main() {
  const args = parseArgs(process.argv);
  const errs = validateArgs(args);
  if (errs.length) {
    console.error('[probe] 参数校验失败:\n  - ' + errs.join('\n  - '));
    process.exit(2);
  }
  if (!args.simulate) process.env.PDD_SCRAPE_SIMULATE = '0';

  console.error(`[probe] interval=${args.interval}ms max=${args.max} goods=${args.goods.join(',')} simulate=${args.simulate} headed=${args.headed}`);

  const { browser } = await launchBrowser({ headed: args.headed });
  const consumer = await createConsumerContext(browser, { storageStatePath: CONSUMER_AUTH_STATE_PATH });

  const t0 = Date.now();
  let triggered = null;
  let okCount = 0;

  try {
    for (let i = 1; i <= args.max; i++) {
      const goodsId = args.goods[(i - 1) % args.goods.length];
      const page = await consumer.context.newPage();
      const reqStart = Date.now();
      let row;
      try {
        const data = await scrapeSourceGoods(page, goodsId, { sessionHealth: noopHealth });
        okCount++;
        row = { i, goodsId, ms: Date.now() - reqStart, masked: false, price: data.price, skuLen: (data.skuText || '').length };
      } catch (err) {
        row = { i, goodsId, ms: Date.now() - reqStart, code: err.code || 'UNKNOWN', message: err.message };
        if (err.code === 'E_RISK_CONTROL_SOFT') {
          row.masked = true;
          triggered = { i, elapsedMs: Date.now() - t0, detail: err.detail };
        }
      } finally {
        try { await page.close(); } catch { /* ignore */ }
      }

      console.log(JSON.stringify(row));

      if (triggered) {
        console.error(`[probe] ✅ 软风控脱敏在第 ${triggered.i} 次请求触发（间隔 ${args.interval}ms，累计 ${(triggered.elapsedMs / 1000).toFixed(1)}s，前置成功 ${okCount} 次）`);
        console.error(`[probe] 检测信号: ${JSON.stringify(triggered.detail)}`);
        break;
      }
      if (row.code && row.code !== 'E_RISK_CONTROL_SOFT') {
        console.error(`[probe] ⚠️ 第 ${i} 次出现非脱敏错误 ${row.code}，停止探测`);
        break;
      }
      if (i < args.max) await sleep(args.interval);
    }

    if (!triggered) {
      console.error(`[probe] 未在 ${args.max} 次请求内触发脱敏（间隔 ${args.interval}ms）。可减小 --interval 或增大 --max 继续探测。`);
    }
  } finally {
    try { await consumer.close(); } catch { /* ignore */ }
    try { await closeBrowser(browser); } catch { /* ignore */ }
  }

  process.exit(triggered ? 0 : 2);
}

main().catch((err) => {
  console.error('[probe] fatal:', err?.stack || err?.message || err);
  process.exit(1);
});
