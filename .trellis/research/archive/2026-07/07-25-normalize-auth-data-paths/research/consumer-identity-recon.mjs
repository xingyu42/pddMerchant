import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, createConsumerContext, closeBrowser } from '../../../../src/adapter/browser.js';

const authStatePath = join(process.cwd(), 'data', 'consumer-auth-state.json');
const candidateKey = /(nick|name|mobile|phone|uid|user.?id|avatar|account)/i;
const candidateUrl = /(personal|profile|account|user|member|login)/i;

function describe(value) {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) return { type: 'array', length: value.length };
  if (typeof value === 'string') {
    const digits = value.replace(/\D/g, '');
    return {
      type: 'string',
      length: value.length,
      digitCount: digits.length,
      last4: digits.length >= 7 ? digits.slice(-4) : undefined,
    };
  }
  return { type: typeof value };
}

function collectCandidates(value, path = '$', out = [], depth = 0) {
  if (depth > 7 || value == null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    value.slice(0, 5).forEach((item, index) => collectCandidates(item, `${path}[${index}]`, out, depth + 1));
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (candidateKey.test(key)) out.push({ path: childPath, ...describe(child) });
    collectCandidates(child, childPath, out, depth + 1);
  }
  return out;
}

if (!existsSync(authStatePath)) {
  console.log(JSON.stringify({ ok: false, reason: 'consumer_auth_state_missing' }));
  process.exit(2);
}

const result = { ok: true, pages: [], responses: [] };
const launched = await launchBrowser({ headed: false });
let consumer;
try {
  consumer = await createConsumerContext(launched.browser, { storageStatePath: authStatePath });
  const { page } = consumer;

  page.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] ?? '';
    if (!contentType.includes('json') && !candidateUrl.test(url)) return;
    try {
      const body = await response.json();
      const candidates = collectCandidates(body);
      if (candidates.length > 0) {
        result.responses.push({ url: new URL(url).pathname, status: response.status(), candidates });
      }
    } catch {
      // Non-JSON responses are intentionally ignored.
    }
  });

  await page.goto('https://mobile.yangkeduo.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(5_000);

  const pageSnapshot = await page.evaluate(() => {
    const roots = ['rawData', '__NEXT_DATA__', '__INITIAL_STATE__', '__PRELOADED_STATE__'];
    const globals = Object.fromEntries(roots
      .filter((key) => globalThis[key] != null)
      .map((key) => [key, globalThis[key]]));
    const links = [...document.querySelectorAll('a[href]')]
      .map((node) => ({ href: node.href, textLength: (node.textContent ?? '').trim().length }))
      .filter((item) => /(personal|profile|account|user|member)/i.test(item.href))
      .slice(0, 20);
    return {
      url: location.href,
      titleLength: document.title.length,
      localStorageKeys: Object.keys(localStorage),
      sessionStorageKeys: Object.keys(sessionStorage),
      globals,
      links,
    };
  });

  result.pages.push({
    url: new URL(pageSnapshot.url).pathname,
    titleLength: pageSnapshot.titleLength,
    localStorageKeys: pageSnapshot.localStorageKeys,
    sessionStorageKeys: pageSnapshot.sessionStorageKeys,
    globalCandidates: collectCandidates(pageSnapshot.globals),
    links: pageSnapshot.links.map((item) => ({ path: new URL(item.href).pathname, textLength: item.textLength })),
  });
} finally {
  await consumer?.close().catch(() => {});
  await closeBrowser(launched.browser).catch(() => {});
}

console.log(JSON.stringify(result, null, 2));
