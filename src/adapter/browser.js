import { existsSync } from 'node:fs';
import { chromium } from 'patchright';
import { isMockEnabled, mockLaunchBrowser, mockCloseBrowser } from './mock-dispatcher.js';
import { getLogger } from '../infra/logger.js';

const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };

// --- Browser Lifecycle Registry ---
const activeBrowsers = new Set();
const closingBrowsers = new WeakSet();
let closeAllPromise = null;

export function registerBrowser(browser) {
  if (browser) activeBrowsers.add(browser);
  return browser;
}

export function unregisterBrowser(browser) {
  activeBrowsers.delete(browser);
}

export function getBrowserExecutablePath() {
  return chromium.executablePath();
}

export function evaluateInMainWorld(page, pageFunction, arg) {
  return page.evaluate(pageFunction, arg, false);
}

export async function closeAllBrowsers({ timeoutMs = 5000 } = {}) {
  if (closeAllPromise) return closeAllPromise;
  closeAllPromise = (async () => {
    const snapshot = [...activeBrowsers];
    await Promise.allSettled(snapshot.map((b) => closeBrowser(b)));
  })();
  try { return await closeAllPromise; }
  finally { closeAllPromise = null; }
}

export async function launchBrowser({
  headed = false,
  storageStatePath,
  viewport = DEFAULT_VIEWPORT,
  extraContextOptions = {},
} = {}) {
  if (isMockEnabled()) return mockLaunchBrowser();
  const browser = await chromium.launch({
    headless: !headed,
  });
  registerBrowser(browser);

  try {
    const contextOptions = {
      viewport,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      deviceScaleFactor: 2,
      ...extraContextOptions,
    };
    if (storageStatePath && existsSync(storageStatePath)) {
      contextOptions.storageState = storageStatePath;
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    return { browser, context, page };
  } catch (err) {
    await closeBrowser(browser);
    throw err;
  }
}

export async function closeBrowser(browser) {
  if (isMockEnabled()) return mockCloseBrowser(browser);
  if (!browser) return;
  if (closingBrowsers.has(browser)) return;
  closingBrowsers.add(browser);
  try {
    const contexts = browser.contexts();
    for (const ctx of contexts) {
      try { await ctx.close(); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  try { await browser.close(); } catch { /* ignore */ }
  finally { unregisterBrowser(browser); }
}

export async function withBrowser(options, fn) {
  const log = getLogger();
  let browser = null;
  let context = null;
  let page = null;

  try {
    const result = await launchBrowser(options);
    browser = result.browser;
    context = result.context;
    page = result.page;
  } catch (err) {
    if (page) { try { await page.close(); } catch (e) { log.warn({ err: e?.message }, 'withBrowser: page cleanup failed'); } }
    if (context) { try { await context.close(); } catch (e) { log.warn({ err: e?.message }, 'withBrowser: context cleanup failed'); } }
    if (browser) { try { await browser.close(); } catch (e) { log.warn({ err: e?.message }, 'withBrowser: browser cleanup failed'); } }
    throw err;
  }

  try {
    const result = await fn({ browser, context, page });
    try { await closeBrowser(browser); } catch (e) { log.warn({ err: e?.message }, 'withBrowser: cleanup on success failed'); }
    return result;
  } catch (err) {
    try { await closeBrowser(browser); } catch (e) { log.warn({ err: e?.message }, 'withBrowser: cleanup on error failed'); }
    throw err;
  }
}

export async function createConsumerContext(browser, {
  storageStatePath,
  viewport = DEFAULT_VIEWPORT,
  proxy,
} = {}) {
  const contextOptions = {
    viewport,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    deviceScaleFactor: 2,
  };
  if (storageStatePath && existsSync(storageStatePath)) {
    contextOptions.storageState = storageStatePath;
  }
  if (proxy) {
    contextOptions.proxy = proxy;
  }
  const context = await browser.newContext(contextOptions);
  let page = null;

  try {
    page = await context.newPage();
  } catch (err) {
    try { await page?.close(); } catch { /* ignore */ }
    try { await context.close(); } catch { /* ignore */ }
    throw err;
  }

  return {
    context,
    page,
    async close() {
      try { await page.close(); } catch { /* ignore */ }
      try { await context.close(); } catch { /* ignore */ }
    },
  };
}

export { DEFAULT_VIEWPORT };
