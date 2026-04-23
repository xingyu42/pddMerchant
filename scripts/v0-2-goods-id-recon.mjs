#!/usr/bin/env node
// V0.2 #2 Goods-ID Recon
//
// 目的：遍历 PDD 商家后台的若干 goods 相关页面，捕获所有 JSON XHR 响应，
// 找出其中包含 **非 null goods_id** 字段的 endpoint，作为 `vodka/v2/mms/query/display/mall/goodsList`
// （该 endpoint goods_id 全 null）的候选替代或补充。
//
// 使用：
//   node scripts/v0-2-goods-id-recon.mjs                   # 默认 headless
//   node scripts/v0-2-goods-id-recon.mjs --headed          # 有头模式（排查用）
//   node scripts/v0-2-goods-id-recon.mjs --pages <csv>     # 覆盖默认页面列表
//
// 前置：data/auth-state.json 有效（失效请先 `pdd login`）

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const AUTH_STATE_PATH = join(PROJECT_ROOT, 'data', 'auth-state.json');

const args = process.argv.slice(2);
function boolFlag(name) {
  return args.includes(name);
}
function valueFlag(name) {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const next = args[i + 1];
  if (next == null || next.startsWith('--')) return null;
  return next;
}
const HEADED = boolFlag('--headed');
const VERBOSE = boolFlag('--verbose');
const PAGE_OVERRIDE = typeof valueFlag('--pages') === 'string' ? valueFlag('--pages').split(',') : null;

// 候选页面 — 覆盖常见 goods 管理入口
const DEFAULT_PAGES = [
  // 商品管理（current goods.list source）
  { name: 'goods_list', url: 'https://mms.pinduoduo.com/goods/goods_list/v2' },
  // 数据中心 - 商品概览
  { name: 'data_goods_overview', url: 'https://mms.pinduoduo.com/data/goods/goods-analysis' },
  { name: 'data_goods_sales', url: 'https://mms.pinduoduo.com/data/goods/sales' },
  // 商品管理 - 其他子 tab
  { name: 'goods_all', url: 'https://mms.pinduoduo.com/goods/goods_list/v2?tab=all' },
  { name: 'goods_selling', url: 'https://mms.pinduoduo.com/goods/goods_list/v2?tab=on_sale' },
  // 运营中心 / 管理全部
  { name: 'goods_manage', url: 'https://mms.pinduoduo.com/goods/manage/goods' },
  // 促销管理（可能也有 goods_id）
  { name: 'promotion_list', url: 'https://mms.pinduoduo.com/promotion/activity-list' },
];

const PAGES = PAGE_OVERRIDE
  ? PAGE_OVERRIDE.map((url, i) => ({ name: `custom-${i}`, url }))
  : DEFAULT_PAGES;

const CAPTURE_WINDOW_MS = 15000;

// 递归找 goods_id 字段（任意嵌套深度）
// V0.2 #2: 扩展关键字集合，PDD 内部可能用 goods_id / goodsId / goodsID / productId / mall_goods_id / online_goods_id 等变体
const GOODS_ID_KEYS = ['goods_id', 'goodsId', 'goodsID', 'productId', 'product_id', 'mall_goods_id', 'mallGoodsId', 'online_goods_id', 'onlineGoodsId', 'mallItemId', 'itemId', 'skuId', 'sku_id'];
const GOODS_NAME_KEYS = ['goods_name', 'goodsName', 'productName', 'product_name', 'itemName', 'item_name', 'title'];

function hasGoodsNameKey(obj) {
  return GOODS_NAME_KEYS.some((k) => k in obj);
}

function hasGoodsIdKey(obj) {
  for (const k of GOODS_ID_KEYS) if (k in obj) return k;
  return null;
}

function getGoodsIdValue(obj) {
  for (const k of GOODS_ID_KEYS) if (k in obj) return { key: k, value: obj[k] };
  return null;
}

function findGoodsIdSamples(value, seen = new Set(), depth = 0, samples = [], maxSamples = 5) {
  if (value == null || depth > 12 || samples.length >= maxSamples) return samples;
  if (Array.isArray(value)) {
    for (const item of value) {
      findGoodsIdSamples(item, seen, depth + 1, samples, maxSamples);
      if (samples.length >= maxSamples) break;
    }
    return samples;
  }
  if (typeof value !== 'object') return samples;
  if (seen.has(value)) return samples;
  seen.add(value);
  const got = getGoodsIdValue(value);
  if (got) {
    samples.push({
      key: got.key,
      value: got.value,
      value_type: typeof got.value,
      sibling_keys: Object.keys(value).slice(0, 15),
      has_goods_name: 'goods_name' in value || 'goodsName' in value,
    });
  }
  for (const nested of Object.values(value)) {
    findGoodsIdSamples(nested, seen, depth + 1, samples, maxSamples);
    if (samples.length >= maxSamples) break;
  }
  return samples;
}

// 计算 goods_id 命中统计：分别统计 null / 非 null
// 也统计 goods_name 字段（同一 endpoint 有 name 但无 id，也是候选线索）
function countGoodsIds(value, seen = new Set(), depth = 0, stats = {
  total: 0, nonNull: 0, nullCount: 0, keyHits: {},
  nameTotal: 0, nameKeyHits: {},
}) {
  if (value == null || depth > 12) return stats;
  if (Array.isArray(value)) {
    for (const item of value) countGoodsIds(item, seen, depth + 1, stats);
    return stats;
  }
  if (typeof value !== 'object') return stats;
  if (seen.has(value)) return stats;
  seen.add(value);
  for (const k of GOODS_ID_KEYS) {
    if (!(k in value)) continue;
    const id = value[k];
    stats.total += 1;
    stats.keyHits[k] = (stats.keyHits[k] ?? 0) + 1;
    if (id == null || id === '' || id === 0) stats.nullCount += 1;
    else stats.nonNull += 1;
  }
  for (const k of GOODS_NAME_KEYS) {
    if (!(k in value)) continue;
    stats.nameTotal += 1;
    stats.nameKeyHits[k] = (stats.nameKeyHits[k] ?? 0) + 1;
  }
  for (const nested of Object.values(value)) countGoodsIds(nested, seen, depth + 1, stats);
  return stats;
}

async function runPage(browser, page, { name, url }) {
  const hits = new Map(); // urlKey → { stats, samples, bodyBytes }
  const allJsonUrls = new Map(); // urlKey → { count, firstBodyBytes }
  let totalResponses = 0;
  let jsonResponses = 0;
  let parseFailures = 0;

  const handler = async (response) => {
    try {
      totalResponses += 1;
      const respUrl = response.url();
      if (!/mms\.pinduoduo\.com|yangkeduo\.com/.test(respUrl)) return;
      const headers = response.headers();
      const ct = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
      if (!/application\/json/i.test(ct)) return;
      jsonResponses += 1;

      let body;
      try {
        body = await response.json();
      } catch {
        parseFailures += 1;
        return;
      }

      const urlKey = respUrl.split('?')[0];
      const bodyBytes = JSON.stringify(body).length;
      const existingAll = allJsonUrls.get(urlKey);
      allJsonUrls.set(urlKey, {
        count: (existingAll?.count ?? 0) + 1,
        firstBodyBytes: existingAll?.firstBodyBytes ?? bodyBytes,
      });

      const stats = countGoodsIds(body);
      if (stats.total === 0 && stats.nameTotal === 0) return;
      const existing = hits.get(urlKey);
      const merged = existing ? {
        ...existing,
        stats: {
          total: existing.stats.total + stats.total,
          nonNull: existing.stats.nonNull + stats.nonNull,
          nullCount: existing.stats.nullCount + stats.nullCount,
          keyHits: Object.entries(stats.keyHits).reduce((acc, [k, v]) => {
            acc[k] = (acc[k] ?? 0) + v;
            return acc;
          }, { ...(existing.stats.keyHits ?? {}) }),
        },
      } : {
        stats,
        samples: findGoodsIdSamples(body),
        bodyBytes,
        firstUrl: respUrl,
      };
      hits.set(urlKey, merged);
    } catch { /* ignore */ }
  };

  page.on('response', handler);
  try {
    console.log(`\n▶ ${name}: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, CAPTURE_WINDOW_MS));
    const finalUrl = page.url();
    if (finalUrl !== url) console.log(`  ⚠ redirect → ${finalUrl}`);
  } catch (err) {
    console.error(`  ! goto failed: ${err?.message}`);
  } finally {
    page.off('response', handler);
  }
  console.log(`  resp: total=${totalResponses} json=${jsonResponses} parseFail=${parseFailures} hits=${hits.size}`);
  if (VERBOSE) {
    console.log(`  JSON URLs sample (first 20):`);
    [...allJsonUrls.entries()].slice(0, 20).forEach(([u, m]) => {
      console.log(`    ${m.count}x ${u.replace('https://mms.pinduoduo.com', '')} (${m.firstBodyBytes}B)`);
    });
  }
  return { name, url, hits, allJsonUrls };
}

async function main() {
  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  const page = await context.newPage();

  const results = [];
  for (const p of PAGES) {
    results.push(await runPage(browser, page, p));
  }

  await context.close();
  await browser.close();

  // 汇总：按 urlKey 合并所有 pages 的命中
  const global = new Map();
  for (const r of results) {
    for (const [urlKey, info] of r.hits) {
      const existing = global.get(urlKey);
      if (!existing) {
        global.set(urlKey, { ...info, seenOnPages: [r.name] });
      } else {
        existing.stats.total += info.stats.total;
        existing.stats.nonNull += info.stats.nonNull;
        existing.stats.nullCount += info.stats.nullCount;
        existing.seenOnPages.push(r.name);
      }
    }
  }

  // 按 nonNull 降序
  const sorted = [...global.entries()].sort((a, b) => b[1].stats.nonNull - a[1].stats.nonNull);

  const md = [];
  md.push(`# V0.2 #2 Goods-ID Recon (${new Date().toISOString().slice(0, 10)})`);
  md.push('');
  md.push(`- Headed: ${HEADED ? 'yes' : 'no'}`);
  md.push(`- Pages scanned: ${PAGES.length}`);
  md.push(`- Distinct goods_id-bearing endpoints: ${sorted.length}`);
  md.push('');
  md.push('## Endpoints sorted by non-null goods_id count');
  md.push('');
  md.push('| # | URL | total | non-null | null | first seen page | size |');
  md.push('|---|-----|-------|----------|------|-----------------|------|');
  sorted.forEach(([urlKey, info], i) => {
    const short = urlKey.replace('https://mms.pinduoduo.com', '').replace('https://yangkeduo.com', '(yangkeduo)');
    md.push(
      `| ${i + 1} | \`${short}\` | ${info.stats.total} | ${info.stats.nonNull} | ${info.stats.nullCount} | ${info.seenOnPages[0]} | ${info.bodyBytes}B |`,
    );
  });
  md.push('');
  md.push('## Top 5 endpoint samples');
  md.push('');
  sorted.slice(0, 5).forEach(([urlKey, info]) => {
    md.push(`### \`${urlKey.replace('https://mms.pinduoduo.com', '')}\``);
    md.push('');
    md.push(`- Pages: ${info.seenOnPages.join(', ')}`);
    md.push(`- Stats: total=${info.stats.total} nonNull=${info.stats.nonNull} null=${info.stats.nullCount}`);
    md.push('');
    md.push('**Samples**:');
    md.push('```json');
    md.push(JSON.stringify(info.samples.slice(0, 3), null, 2));
    md.push('```');
    md.push('');
  });

  const outDir = join(PROJECT_ROOT, '.context', 'recon');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'v0-2-goods-id-endpoints.md');
  writeFileSync(outFile, md.join('\n'), 'utf8');
  console.log(`\n📝 ${outFile}`);
  console.log(`\nSummary: ${sorted.length} endpoints with goods_id fields; top non-null:`);
  sorted.slice(0, 5).forEach(([urlKey, info]) => {
    console.log(`  ${info.stats.nonNull.toString().padStart(4)} non-null  ${urlKey.replace('https://mms.pinduoduo.com', '')}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
