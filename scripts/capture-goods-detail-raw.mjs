#!/usr/bin/env node
/**
 * 一次性原始数据采集脚本。
 *
 * 只保存两类数据：
 *   1. oak/integration XHR/fetch 响应正文（不改写）
 *   2. 页面解密后命中的完整商品对象（字段无关序列化）
 *
 * 不保存请求头、Cookie、代理节点、schema、字段投影或分析摘要；
 * 运行时商品对象中的认证/个人敏感字段会被遮蔽，网络响应正文保持原样。
 * 不进入 goods publish，不创建草稿，不提交商品。
 *
 * 用法：
 *   node scripts/capture-goods-detail-raw.mjs --goods 447841256386
 *   node scripts/capture-goods-detail-raw.mjs --goods 447841256386 --headed
 *   node scripts/capture-goods-detail-raw.mjs --goods 447841256386 --direct
 *   node scripts/capture-goods-detail-raw.mjs --goods 447841256386 --keep-ms 8000
 *   node scripts/capture-goods-detail-raw.mjs --goods 447841256386 --out data/investigation/manual-raw
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  closeBrowser,
  createConsumerContext,
  evaluateInMainWorld,
  launchBrowser,
} from '../src/adapter/browser.js';
import {
  acquireQingguoProxyLease,
  readSourceProxyConfig,
} from '../src/adapter/goods-publish/qingguo-proxy.js';
import { CONSUMER_AUTH_STATE_PATH, PROJECT_ROOT } from '../src/infra/paths.js';

const SCRIPT_NAME = 'capture-goods-detail-raw';
const DEFAULT_KEEP_MS = 4500;
const MAX_SEARCH_OBJECTS = 30_000;
const RAW_ENDPOINT_MARKER = 'oak/integration/';

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
    keepMs: DEFAULT_KEEP_MS,
    outDir: null,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--goods') args.goodsId = argv[++index];
    else if (arg === '--headed') args.headed = true;
    else if (arg === '--direct') args.direct = true;
    else if (arg === '--keep-ms') args.keepMs = Number(argv[++index]);
    else if (arg === '--out') args.outDir = argv[++index];
    else throw Object.assign(new Error(`未知参数: ${arg}`), { exitCode: 2 });
  }

  if (!/^\d+$/.test(String(args.goodsId ?? ''))) {
    throw Object.assign(new Error('--goods 必须提供纯数字 goods_id'), { exitCode: 2 });
  }
  if (!Number.isFinite(args.keepMs) || args.keepMs < 0 || args.keepMs > 60_000) {
    throw Object.assign(new Error('--keep-ms 必须是 0..60000 的数字'), { exitCode: 2 });
  }
  return args;
}

function stampNow() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function defaultOutDir(goodsId) {
  return join(PROJECT_ROOT, 'data', 'investigation', `${stampNow()}_goods-${goodsId}-raw`);
}

async function resolveProxy(direct) {
  if (direct) {
    console.error(`[${SCRIPT_NAME}] --direct：强制直连`);
    return { proxy: null, provider: 'direct' };
  }

  const config = readSourceProxyConfig();
  if (!config.enabled) {
    console.error(`[${SCRIPT_NAME}] 未配置代理：直连`);
    return { proxy: null, provider: 'direct' };
  }

  const lease = await acquireQingguoProxyLease(config);
  const remainingSec = Math.max(0, Math.floor((lease.expiresAt - Date.now()) / 1000));
  console.error(
    `[${SCRIPT_NAME}] 青果代理已获取: area=${lease.area ?? '-'} `
    + `isp=${lease.isp ?? '-'} 剩余=${remainingSec}s reqIdHash=${lease.requestIdHash ?? '-'}`,
  );
  return {
    proxy: { server: lease.server },
    provider: lease.provider,
  };
}

function buildGoodsUrl(goodsId) {
  return `https://mobile.yangkeduo.com/goods.html?goods_id=${goodsId}`
    + '&refer_page_name=search_result&refer_page_id=10033&refer_page_sn=10033';
}

function responseKind(url) {
  const lower = String(url ?? '').toLowerCase();
  if (lower.includes('/render')) return 'render';
  if (lower.includes('/require_extra')) return 'require-extra';
  return 'integration';
}

function attachRawResponseCapture(page, bag) {
  const listener = (response) => {
    let url;
    let resourceType;
    try {
      url = response.url();
      if (!url.toLowerCase().includes(RAW_ENDPOINT_MARKER)) return;
      resourceType = response.request().resourceType();
      if (resourceType !== 'xhr' && resourceType !== 'fetch') return;
    } catch {
      return;
    }

    const sequence = ++bag.sequence;
    const task = (async () => {
      try {
        const body = await response.text();
        const kind = responseKind(url);
        bag.responses.push({ sequence, kind, body });
        if (kind === 'render') {
          console.error(
            `[${SCRIPT_NAME}] 捕获 render 原始响应 #${sequence}: `
            + `status=${response.status()} bytes=${Buffer.byteLength(body, 'utf8')}`,
          );
        }
      } catch {
        bag.failures += 1;
      }
    })();

    bag.pending.add(task);
    void task.then(() => bag.pending.delete(task));
  };

  page.on('response', listener);
  return async () => {
    try { page.off('response', listener); } catch { /* ignore */ }
    while (bag.pending.size > 0) {
      await Promise.allSettled([...bag.pending]);
    }
  };
}

/**
 * 在页面主世界查找目标商品对象，并把整个对象转成 JSON。
 * 只过滤框架内部字段和认证/个人敏感值，不做任何业务字段投影。
 */
function extractRawGoods(options) {
  const { targetGoodsId, maxSearchObjects } = options;

  function unwrapObservable(value) {
    let current = value;
    for (let depth = 0; depth < 3; depth += 1) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) break;
      const isObservableValue = Object.prototype.hasOwnProperty.call(current, 'value')
        && (
          Object.prototype.hasOwnProperty.call(current, 'observers')
          || Object.prototype.hasOwnProperty.call(current, 'enhancer')
          || Object.prototype.hasOwnProperty.call(current, 'diffValue')
        );
      if (!isObservableValue) break;
      current = current.value;
    }
    return current;
  }

  function readValue(record, keys) {
    if (!record || typeof record !== 'object') return undefined;
    for (const key of keys) {
      try {
        if (record[key] !== undefined) return unwrapObservable(record[key]);
      } catch {
        // 继续尝试下一个别名
      }
    }
    return undefined;
  }

  function toList(value) {
    const unwrapped = unwrapObservable(value);
    if (Array.isArray(unwrapped)) return unwrapped;
    if (
      unwrapped
      && typeof unwrapped !== 'string'
      && typeof unwrapped[Symbol.iterator] === 'function'
    ) {
      try { return Array.from(unwrapped); } catch { return []; }
    }
    return [];
  }

  function isSensitiveKey(key) {
    const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalized === 'cookie'
      || normalized === 'cookies'
      || normalized === 'authorization'
      || normalized === 'anticontent'
      || normalized === 'crawlerinfo'
      || normalized === 'uin'
      || normalized === 'uid'
      || normalized === 'pdduid'
      || normalized === 'pdduseruin'
      || normalized === 'pdduserid'
      || normalized === 'phone'
      || normalized === 'mobile'
      || normalized === 'password'
      || normalized === 'credential'
      || normalized === 'credentials'
      || normalized === 'ciphertext'
      || normalized === 'qrcontent'
      || normalized.endsWith('token')
      || normalized.endsWith('userid')
      || normalized.endsWith('useruin')
      || normalized.startsWith('receiver')
      || normalized.endsWith('address');
  }

  function serializeRaw(value) {
    const seen = new WeakSet();
    return JSON.stringify(value, (key, input) => {
      if (
        key === '$mobx'
        || key.startsWith('__reactFiber')
        || key.startsWith('__reactContainer')
        || key.startsWith('__reactInternalInstance')
      ) {
        return undefined;
      }
      if (isSensitiveKey(key)) return '[redacted]';

      const current = unwrapObservable(input);
      if (typeof current === 'bigint') return String(current);
      if (typeof current === 'number' && !Number.isFinite(current)) return String(current);
      if (typeof current === 'function' || typeof current === 'symbol') return undefined;
      if (current && typeof current === 'object') {
        if (seen.has(current)) return '[Circular]';
        seen.add(current);
      }
      return current;
    }, 2);
  }

  function collectRoots() {
    const roots = [];
    if (globalThis.rawData && typeof globalThis.rawData === 'object') {
      roots.push({ value: globalThis.rawData, path: 'window.rawData' });
    }
    if (globalThis.__NEXT_DATA__ && typeof globalThis.__NEXT_DATA__ === 'object') {
      roots.push({ value: globalThis.__NEXT_DATA__, path: 'window.__NEXT_DATA__' });
    }

    let scannedElements = 0;
    for (const element of document.querySelectorAll('*')) {
      scannedElements += 1;
      if (scannedElements > 8000 || roots.length >= 120) break;
      for (const key of Object.getOwnPropertyNames(element)) {
        if (
          !key.startsWith('__reactFiber')
          && !key.startsWith('__reactContainer')
          && !key.startsWith('__reactInternalInstance')
        ) continue;
        const value = element[key];
        if (value && typeof value === 'object') {
          roots.push({ value, path: `dom:${element.tagName.toLowerCase()}:${key}` });
        }
        break;
      }
    }
    return { roots, scannedElements };
  }

  function findCandidate(roots) {
    const queue = roots.map((root) => ({ ...root, depth: 0 }));
    const seen = new WeakSet();
    let visited = 0;

    while (queue.length > 0 && visited < maxSearchObjects) {
      const current = queue.shift();
      const value = current?.value;
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      visited += 1;

      const unwrapped = unwrapObservable(value);
      if (!unwrapped || typeof unwrapped !== 'object') continue;
      const goodsId = readValue(unwrapped, ['goodsID', 'goodsId', 'goods_id']);
      const skus = toList(readValue(unwrapped, ['skus', 'skuList', 'sku_list']));
      if (String(goodsId ?? '') === String(targetGoodsId) && skus.length > 0) {
        return {
          raw_json: serializeRaw(unwrapped),
          source_path: current.path,
          sku_count: skus.length,
          visited,
          exhausted: false,
        };
      }

      if (current.depth >= 14) continue;
      let descriptors;
      try { descriptors = Object.getOwnPropertyDescriptors(unwrapped); } catch { continue; }
      for (const [key, descriptor] of Object.entries(descriptors)) {
        const child = descriptor?.value;
        if (child && typeof child === 'object') {
          queue.push({
            value: child,
            path: `${current.path}.${key}`,
            depth: current.depth + 1,
          });
        }
      }
    }

    return { raw_json: null, source_path: null, sku_count: 0, visited, exhausted: queue.length > 0 };
  }

  const rootInfo = collectRoots();
  const result = findCandidate(rootInfo.roots);
  const bodyText = document.body?.innerText ?? '';
  return {
    ...result,
    has_raw_data: Boolean(globalThis.rawData && typeof globalThis.rawData === 'object'),
    app_wall: /打开(拼多多)?APP|在APP(内|中)?(打开|查看)|下载拼多多|立即打开/i.test(bodyText),
    mask_hint: /前往APP查看价格|APP内?查看价格|登录后?查看价格|查看完整价格/i.test(bodyText),
  };
}

async function captureRuntime(page, goodsId) {
  let latest = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    latest = await evaluateInMainWorld(page, extractRawGoods, {
      targetGoodsId: goodsId,
      maxSearchObjects: MAX_SEARCH_OBJECTS,
    });
    console.error(
      `[${SCRIPT_NAME}] runtime#${attempt}: found=${Boolean(latest.raw_json)} `
      + `visited=${latest.visited} rawData=${latest.has_raw_data}`,
    );
    if (latest.raw_json) break;
    if (attempt < 3) await page.waitForTimeout(400);
  }
  return latest;
}

function rawBodyExtension(body) {
  try {
    JSON.parse(body);
    return 'json';
  } catch {
    return 'txt';
  }
}

async function writeNetworkBodies(outDir, responses) {
  const files = [];
  const ordered = [...responses].sort((left, right) => left.sequence - right.sequence);
  for (let index = 0; index < ordered.length; index += 1) {
    const response = ordered[index];
    const number = String(index + 1).padStart(3, '0');
    const extension = rawBodyExtension(response.body);
    const filename = `network-${number}-${response.kind}.${extension}`;
    await writeFile(join(outDir, filename), response.body, 'utf8');
    files.push(filename);
  }
  return files;
}

async function writeRuntimeRaw(outDir, runtime) {
  if (!runtime?.raw_json) return [];
  const filename = 'runtime-goods.json';
  await writeFile(join(outDir, filename), runtime.raw_json, 'utf8');
  return [filename];
}

async function runCapture(args, proxyInfo, networkBag) {
  let launched = null;
  let consumer = null;
  let finishNetworkCapture = null;
  let runtime = null;
  let captureError = null;

  try {
    launched = await launchBrowser({ headed: args.headed });
    await launched.context.close();
    consumer = await createConsumerContext(launched.browser, {
      storageStatePath: process.env.PDD_CONSUMER_AUTH_STATE_PATH || CONSUMER_AUTH_STATE_PATH,
      ...(proxyInfo.proxy ? { proxy: proxyInfo.proxy } : {}),
    });
    finishNetworkCapture = attachRawResponseCapture(consumer.page, networkBag);

    console.error(`[${SCRIPT_NAME}] 导航: goods_id=${args.goodsId} mode=${proxyInfo.provider}`);
    const renderWait = consumer.page
      .waitForResponse((response) => response.url().includes('oak/integration/render'), {
        timeout: 20_000,
      })
      .catch(() => null);

    await consumer.page.goto(buildGoodsUrl(args.goodsId), {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await renderWait;
    if (args.keepMs > 0) await consumer.page.waitForTimeout(args.keepMs);
    runtime = await captureRuntime(consumer.page, args.goodsId);
  } catch (error) {
    captureError = error;
  } finally {
    try { await finishNetworkCapture?.(); } catch { /* ignore */ }
    try { await consumer?.close(); } catch { /* ignore */ }
    try { await closeBrowser(launched?.browser); } catch { /* ignore */ }
  }

  return { runtime, captureError };
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv);
  const authStatePath = process.env.PDD_CONSUMER_AUTH_STATE_PATH || CONSUMER_AUTH_STATE_PATH;
  if (!existsSync(authStatePath)) {
    throw Object.assign(
      new Error(`消费者登录态不存在: ${authStatePath}。请先完成 consumer login`),
      { exitCode: 3 },
    );
  }

  const outDir = resolve(args.outDir || defaultOutDir(args.goodsId));
  await mkdir(outDir, { recursive: true });
  const proxyInfo = await resolveProxy(args.direct);
  const networkBag = {
    sequence: 0,
    responses: [],
    pending: new Set(),
    failures: 0,
  };

  const { runtime, captureError } = await runCapture(args, proxyInfo, networkBag);
  const networkFiles = await writeNetworkBodies(outDir, networkBag.responses);
  const runtimeFiles = await writeRuntimeRaw(outDir, runtime);

  if (captureError) {
    captureError.message = `${captureError.message}（已保留 ${networkFiles.length} 个原始响应：${outDir}）`;
    throw captureError;
  }
  if (runtimeFiles.length === 0) {
    throw Object.assign(
      new Error(
        `未找到 goods_id=${args.goodsId} 的完整运行时商品对象；`
        + `已保留 ${networkFiles.length} 个原始响应：${outDir}`,
      ),
      { exitCode: 1 },
    );
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    goods_id: args.goodsId,
    out_dir: outDir,
    network_files: networkFiles,
    runtime_files: runtimeFiles,
    network_capture_failures: networkBag.failures,
  }, null, 2)}\n`);
  console.error(`[${SCRIPT_NAME}] 完成 → ${outDir}`);
}

main().catch((error) => {
  const message = error?.code
    ? `${error.code} ${error.message}`
    : (error?.stack || error?.message || String(error));
  console.error(`[${SCRIPT_NAME}] fatal: ${message}`);
  process.exit(error?.exitCode ?? 1);
});
