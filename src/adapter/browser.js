import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { isMockEnabled, mockLaunchBrowser, mockCloseBrowser } from './mock-dispatcher.js';
import { getLogger } from '../infra/logger.js';

const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const STEALTH_SCRIPT = `
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
window.chrome = window.chrome || { runtime: {} };
const originalQuery = window.navigator.permissions && window.navigator.permissions.query;
if (originalQuery) {
  window.navigator.permissions.query = (parameters) =>
    parameters.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : originalQuery(parameters);
}
`;

export async function launchBrowser({
  headed = false,
  storageStatePath,
  viewport = DEFAULT_VIEWPORT,
  userAgent = DEFAULT_USER_AGENT,
  extraContextOptions = {},
} = {}) {
  if (isMockEnabled()) return mockLaunchBrowser();
  const browser = await chromium.launch({
    headless: !headed,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  const contextOptions = {
    viewport,
    userAgent,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    ...extraContextOptions,
  };
  if (storageStatePath && existsSync(storageStatePath)) {
    contextOptions.storageState = storageStatePath;
  }

  const context = await browser.newContext(contextOptions);
  await context.addInitScript(STEALTH_SCRIPT);
  const page = await context.newPage();

  return { browser, context, page };
}

export async function closeBrowser(browser) {
  if (isMockEnabled()) return mockCloseBrowser(browser);
  if (!browser) return;
  try {
    const contexts = browser.contexts();
    for (const ctx of contexts) {
      try { await ctx.close(); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  try { await browser.close(); } catch { /* ignore */ }
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

export { DEFAULT_VIEWPORT, DEFAULT_USER_AGENT };
