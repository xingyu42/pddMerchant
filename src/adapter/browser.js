import { existsSync } from 'node:fs';
import { chromium } from 'patchright';
import { isMockEnabled, mockLaunchBrowser, mockCloseBrowser } from './mock-dispatcher.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';

const DEFAULT_VIEWPORT = Object.freeze({ width: 1902, height: 984 });
const DEFAULT_SCREEN = Object.freeze({ width: 1920, height: 1080 });
const HEADLESS_OVERRIDE_KEYS = Object.freeze(['outerWidth', 'outerHeight', 'availHeight']);
const HEADLESS_LAUNCH_ARGS = Object.freeze(['--enable-gpu']);
const HEADLESS_CONTEXT_BASE = Object.freeze({
  viewport: DEFAULT_VIEWPORT,
  screen: DEFAULT_SCREEN,
  deviceScaleFactor: 1,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
});

// --- Browser Lifecycle Registry ---
const activeBrowsers = new Set();
const closingBrowsers = new WeakSet();
const browserProfiles = new WeakMap();
let closeAllPromise = null;

function browserRuntimeError(reason, message = '浏览器运行时配置无效') {
  return new PddCliError({
    code: 'E_BROWSER_RUNTIME',
    message,
    hint: '确认浏览器版本与当前操作系统受支持，并重新安装 Patchright Chromium',
    detail: { reason },
    exitCode: ExitCodes.GENERAL,
  });
}

export function parseChromeMajorVersion(version) {
  const normalized = typeof version === 'string' ? version.trim() : '';
  const match = /^(\d+)(?:\.|$)/.exec(normalized)
    ?? /(?:Chrome|Chromium)\/(\d+)(?:\.|$)/i.exec(normalized);
  const major = Number(match?.[1]);
  if (!Number.isSafeInteger(major) || major <= 0) {
    throw browserRuntimeError('invalid_browser_version');
  }
  return major;
}

export function buildChromeUserAgent(version, runtimePlatform = process.platform) {
  const major = parseChromeMajorVersion(version);
  const platformToken = {
    linux: 'X11; Linux x86_64',
    win32: 'Windows NT 10.0; Win64; x64',
    darwin: 'Macintosh; Intel Mac OS X 10_15_7',
  }[runtimePlatform];
  if (!platformToken) throw browserRuntimeError('unsupported_browser_platform');
  return `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

export function isChromeChannelMissingError(err) {
  const message = typeof err?.message === 'string' ? err.message : '';
  return /Chromium distribution ['"]chrome['"] is not found/i.test(message)
    || /Executable doesn't exist(?:\s|$)/i.test(message);
}

export function installHeadlessConsistencyProfile() {
  const overrides = [
    [globalThis, 'outerWidth', 1920],
    [globalThis, 'outerHeight', 1080],
    [globalThis.screen, 'availHeight', 1050],
  ];

  for (const [target, property, value] of overrides) {
    let owner = target;
    while (owner && !Object.prototype.hasOwnProperty.call(owner, property)) {
      owner = Object.getPrototypeOf(owner);
    }
    const descriptor = owner ? Object.getOwnPropertyDescriptor(owner, property) : null;
    if (!descriptor || typeof descriptor.get !== 'function') {
      throw new TypeError(`Missing native getter: ${property}`);
    }
    const nativeGetter = descriptor.get;
    const getterProxy = new Proxy(nativeGetter, {
      apply(getter, receiver, args) {
        Reflect.apply(getter, receiver, args);
        return value;
      },
    });
    Object.defineProperty(owner, property, { ...descriptor, get: getterProxy });
  }
}

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

async function launchPreferredBrowser(headless) {
  const launchOptions = (channel) => ({
    headless,
    channel,
    ...(headless ? { args: [...HEADLESS_LAUNCH_ARGS] } : {}),
  });

  try {
    const browser = await chromium.launch(launchOptions('chrome'));
    return { browser, channel: 'chrome' };
  } catch (err) {
    if (!isChromeChannelMissingError(err)) throw err;
    getLogger().warn({
      preferred_channel: 'chrome',
      fallback_channel: 'chromium',
    }, '系统 Chrome 未安装，回退到 Patchright Chromium');
  }

  const browser = await chromium.launch(launchOptions('chromium'));
  return { browser, channel: 'chromium' };
}

async function createRuntimeProfile(browser, { headed, channel }) {
  let version;
  try {
    version = await browser.version();
  } catch {
    throw browserRuntimeError('browser_version_unavailable');
  }
  parseChromeMajorVersion(version);

  if (headed) {
    return Object.freeze({
      mode: 'headed',
      channel,
      version,
      contextOptions: Object.freeze({ viewport: null }),
      installConsistencyScript: false,
    });
  }

  return Object.freeze({
    mode: 'headless',
    channel,
    version,
    contextOptions: Object.freeze({
      ...HEADLESS_CONTEXT_BASE,
      userAgent: buildChromeUserAgent(version),
    }),
    installConsistencyScript: true,
  });
}

function contextOptionsFor(profile, { storageStatePath, proxy } = {}) {
  const options = {
    ...profile.contextOptions,
    ...(profile.contextOptions.viewport ? { viewport: { ...profile.contextOptions.viewport } } : {}),
    ...(profile.contextOptions.screen ? { screen: { ...profile.contextOptions.screen } } : {}),
  };
  if (storageStatePath && existsSync(storageStatePath)) options.storageState = storageStatePath;
  if (proxy) options.proxy = proxy;
  return options;
}

async function createConfiguredContext(browser, profile, options) {
  const context = await browser.newContext(contextOptionsFor(profile, options));
  if (profile.installConsistencyScript) {
    await context.addInitScript(installHeadlessConsistencyProfile);
  }
  return context;
}

async function closePartialContext(page, context) {
  try { await page?.close(); } catch { /* ignore */ }
  try { await context?.close(); } catch { /* ignore */ }
}

export async function closeAllBrowsers({ timeoutMs = 5000 } = {}) {
  void timeoutMs;
  if (closeAllPromise) return closeAllPromise;
  closeAllPromise = (async () => {
    const snapshot = [...activeBrowsers];
    await Promise.allSettled(snapshot.map((browser) => closeBrowser(browser)));
  })();
  try { return await closeAllPromise; }
  finally { closeAllPromise = null; }
}

export async function launchBrowser({ headed = false, storageStatePath } = {}) {
  if (isMockEnabled()) return mockLaunchBrowser();

  let browser = null;
  let context = null;
  let page = null;
  try {
    const launched = await launchPreferredBrowser(!headed);
    browser = registerBrowser(launched.browser);
    const profile = await createRuntimeProfile(browser, { headed, channel: launched.channel });
    browserProfiles.set(browser, profile);
    context = await createConfiguredContext(browser, profile, { storageStatePath });
    page = await context.newPage();
    return { browser, context, page };
  } catch (err) {
    await closePartialContext(page, context);
    await closeBrowser(browser);
    throw err;
  }
}

export async function closeBrowser(browser) {
  if (isMockEnabled()) return mockCloseBrowser(browser);
  if (!browser || closingBrowsers.has(browser)) return;
  closingBrowsers.add(browser);
  try {
    const contexts = browser.contexts();
    for (const context of contexts) {
      try { await context.close(); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  try { await browser.close(); } catch { /* ignore */ }
  finally {
    browserProfiles.delete(browser);
    unregisterBrowser(browser);
  }
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

export async function createConsumerContext(browser, { storageStatePath, proxy } = {}) {
  const profile = browserProfiles.get(browser);
  if (!profile) throw browserRuntimeError('browser_profile_missing');

  let context = null;
  let page = null;
  try {
    context = await createConfiguredContext(browser, profile, { storageStatePath, proxy });
    page = await context.newPage();
  } catch (err) {
    await closePartialContext(page, context);
    throw err;
  }

  return {
    context,
    page,
    async close() {
      await closePartialContext(page, context);
    },
  };
}

export { DEFAULT_VIEWPORT, DEFAULT_SCREEN, HEADLESS_OVERRIDE_KEYS };
