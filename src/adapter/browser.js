import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';
import { daemonBrowserDbPrefix } from '../infra/daemon-state.js';
import { registerCloseAllHook } from '../infra/runtime-cleanup.js';

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
const OWNER_TAG_PATTERN = /^[a-z0-9-]{1,32}$/;

// --- Legacy Module-Level Registry (retained until P0-1#04 & P1-3/P1-4 retire legacy callers) ---
const activeBrowsers = new Set();
const closingBrowsers = new WeakSet();
const browserProfiles = new WeakMap();
let closeAllPromise = null;
let unregisterLegacyCloseHook = null;

function syncLegacyCloseHook() {
  if (activeBrowsers.size > 0 && !unregisterLegacyCloseHook) {
    unregisterLegacyCloseHook = registerCloseAllHook((opts) => closeAllBrowsers(opts));
  } else if (activeBrowsers.size === 0 && unregisterLegacyCloseHook) {
    unregisterLegacyCloseHook();
    unregisterLegacyCloseHook = null;
  }
}

function browserRuntimeError(reason, message = '浏览器运行时配置无效') {
  return new PddCliError({
    code: 'E_BROWSER_RUNTIME',
    message,
    hint: '确认浏览器版本与当前操作系统受支持，并重新安装 Patchright Chromium',
    detail: { reason },
    exitCode: ExitCodes.GENERAL,
  });
}

function assertValidOwnerTag(ownerTag) {
  if (ownerTag !== undefined && (typeof ownerTag !== 'string' || !OWNER_TAG_PATTERN.test(ownerTag))) {
    throw browserRuntimeError('invalid_owner_tag');
  }
}

function assertValidStorageState(storageState, { required = false } = {}) {
  if (!storageState && !required) return;
  if (!Array.isArray(storageState?.cookies) || !Array.isArray(storageState?.origins)) {
    throw browserRuntimeError('snapshot_shape_invalid');
  }
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
  if (browser) {
    activeBrowsers.add(browser);
    syncLegacyCloseHook();
  }
  return browser;
}

export function unregisterBrowser(browser) {
  activeBrowsers.delete(browser);
  syncLegacyCloseHook();
}

// patchright 冷加载约 240ms：只在真正启动浏览器或查询可执行文件路径时加载，其余命令的启动不付这笔成本。
let chromiumRuntime;
async function loadChromium() {
  chromiumRuntime ??= (await import('patchright')).chromium;
  return chromiumRuntime;
}

export async function getBrowserExecutablePath() {
  return (await loadChromium()).executablePath();
}

export function evaluateInMainWorld(page, pageFunction, arg) {
  return page.evaluate(pageFunction, arg, false);
}

async function launchPreferredBrowser(headless, ownerTag, { resolveChromium = loadChromium, resolveLogger = getLogger } = {}) {
  const args = [...(headless ? HEADLESS_LAUNCH_ARGS : []), ...(ownerTag ? [`--pdd-cli-daemon=${ownerTag}`] : [])];
  const launchOptions = (channel) => ({
    headless,
    channel,
    ...(args.length ? { args } : {}),
  });

  const chromium = await resolveChromium();
  try {
    const browser = await chromium.launch(launchOptions('chrome'));
    return { browser, channel: 'chrome' };
  } catch (err) {
    if (!isChromeChannelMissingError(err)) throw err;
    resolveLogger().warn({
      preferred_channel: 'chrome',
      fallback_channel: 'chromium',
    }, '系统 Chrome 未安装，回退到 Patchright Chromium');
  }

  const browser = await chromium.launch(launchOptions('chromium'));
  return { browser, channel: 'chromium' };
}

async function createRuntimeProfile(browser, { headed, channel, platform = process.platform }) {
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
      userAgent: buildChromeUserAgent(version, platform),
    }),
    installConsistencyScript: true,
  });
}

function contextOptionsFor(profile, { storageState, proxy } = {}) {
  const options = {
    ...profile.contextOptions,
    ...(profile.contextOptions.viewport ? { viewport: { ...profile.contextOptions.viewport } } : {}),
    ...(profile.contextOptions.screen ? { screen: { ...profile.contextOptions.screen } } : {}),
  };
  if (storageState) options.storageState = structuredClone({ cookies: storageState.cookies, origins: storageState.origins });
  if (proxy) options.proxy = proxy;
  return options;
}

async function createConfiguredContext(browser, profile, options) {
  const context = await browser.newContext(contextOptionsFor(profile, options));
  try {
    if (profile.installConsistencyScript) {
      await context.addInitScript(installHeadlessConsistencyProfile);
    }
    return context;
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

async function closePartialContext(page, context) {
  try { await page?.close(); } catch { /* ignore */ }
  try { await context?.close(); } catch { /* ignore */ }
}

async function closeBrowserResources(browser, { closingSet, profileMap, onAfterClose }) {
  if (!browser || closingSet.has(browser)) return;
  closingSet.add(browser);
  try {
    const contexts = browser.contexts();
    for (const context of contexts) {
      try { await context.close(); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  try { await browser.close(); } catch { /* ignore */ }
  finally {
    profileMap.delete(browser);
    onAfterClose?.(browser);
  }
}

async function settleWithTimeout(tasks, timeoutMs) {
  const pending = Promise.allSettled(tasks);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    await pending;
    return;
  }
  let timer = null;
  try {
    await Promise.race([
      pending,
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function openBrowserWithProfile({ headed = false, storageState, ownerTag } = {}, deps = {}) {
  assertValidOwnerTag(ownerTag);
  assertValidStorageState(storageState);

  let browser = null;
  let context = null;
  let page = null;
  try {
    const launched = await launchPreferredBrowser(!headed, ownerTag, deps);
    browser = launched.browser;
    deps.onRegister?.(browser);
    const profile = await createRuntimeProfile(browser, {
      headed,
      channel: launched.channel,
      platform: deps.platform,
    });
    deps.profileMap.set(browser, profile);
    context = await createConfiguredContext(browser, profile, { storageState });
    page = await context.newPage();
    return { browser, context, page, profile };
  } catch (err) {
    await closePartialContext(page, context);
    await closeBrowserResources(browser, {
      closingSet: deps.closingSet,
      profileMap: deps.profileMap,
      onAfterClose: deps.onAfterClose,
    });
    throw err;
  }
}

async function deriveConsumerFromProfile(browser, profile, { storageState, proxy } = {}) {
  if (!profile) throw browserRuntimeError('browser_profile_missing');
  assertValidStorageState(storageState);

  let context = null;
  let page = null;
  try {
    context = await createConfiguredContext(browser, profile, { storageState, proxy });
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

async function closeAllBrowsers({ timeoutMs = 5000 } = {}) {
  if (closeAllPromise) return closeAllPromise;
  closeAllPromise = (async () => {
    const snapshot = [...activeBrowsers];
    await settleWithTimeout(snapshot.map((browser) => closeBrowser(browser)), timeoutMs);
  })();
  try { return await closeAllPromise; }
  finally { closeAllPromise = null; }
}

export async function launchBrowser({ headed = false, storageState, ownerTag } = {}) {
  assertValidOwnerTag(ownerTag);
  const { browser, context, page } = await openBrowserWithProfile({ headed, storageState, ownerTag }, {
    profileMap: browserProfiles,
    closingSet: closingBrowsers,
    onRegister: registerBrowser,
    onAfterClose: unregisterBrowser,
  });
  return { browser, context, page };
}

export async function closeBrowser(browser) {
  return closeBrowserResources(browser, {
    closingSet: closingBrowsers,
    profileMap: browserProfiles,
    onAfterClose: unregisterBrowser,
  });
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

export async function createConsumerContext(browser, { storageState, proxy } = {}) {
  return deriveConsumerFromProfile(browser, browserProfiles.get(browser), { storageState, proxy });
}

export async function createSnapshotContext(browser, storageState) {
  const profile = browserProfiles.get(browser);
  if (!profile) throw browserRuntimeError('browser_profile_missing');
  assertValidStorageState(storageState, { required: true });
  return createConfiguredContext(browser, profile, { storageState });
}

export { DEFAULT_VIEWPORT, DEFAULT_SCREEN, HEADLESS_OVERRIDE_KEYS };

// Full process tables (long Chrome/Electron command lines) can exceed execFileSync's 1 MiB default.
const PROCESS_LIST_OPTIONS = Object.freeze({ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 15_000 });

function listLinuxProcesses() {
  const processes = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const argv = readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0');
      processes.push({ pid: Number(entry), imageName: argv[0], commandLine: argv.join(' ') });
    } catch { /* Process exited or belongs to another user. */ }
  }
  return processes;
}

export function listBrowserProcesses(platform = process.platform) {
  if (platform === 'linux') return listLinuxProcesses();
  if (platform === 'win32') {
    const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress';
    const output = execFileSync('powershell', ['-NoProfile', '-Command', script], { ...PROCESS_LIST_OPTIONS, windowsHide: true });
    const rows = JSON.parse(output.trim() || '[]');
    return (Array.isArray(rows) ? rows : [rows]).map((row) => ({ pid: row.ProcessId, imageName: row.Name, commandLine: row.CommandLine }));
  }
  if (platform !== 'darwin') return [];
  const output = execFileSync('ps', ['-axo', 'pid=,command='], PROCESS_LIST_OPTIONS);
  const names = new Map(execFileSync('ps', ['-axo', 'pid=,comm='], PROCESS_LIST_OPTIONS).split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    return match ? [[Number(match[1]), match[2]]] : [];
  }));
  return output.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    return match ? [{ pid: Number(match[1]), imageName: names.get(Number(match[1])), commandLine: match[2] }] : [];
  });
}

function isBrowserProcess({ imageName, commandLine }) {
  const argv0 = /^"([^"]+)"|^'([^']+)'|^(\S+)/.exec(commandLine ?? '');
  const executable = imageName ?? argv0?.slice(1).find(Boolean) ?? '';
  const name = executable.split(/[\\/]/).at(-1);
  return /^(?:chrome(?:\.exe)?|chromium|chromium-browser|headless_shell(?:\.exe)?|Google Chrome|Chromium)$/.test(name);
}

function reclaimMarkedBrowsers({ listProcesses = listBrowserProcesses, kill = process.kill, dbPrefix = daemonBrowserDbPrefix } = {}) {
  let processes;
  try { processes = listProcesses(); }
  catch { return 0; }
  let count = 0;
  const resolvedPrefix = typeof dbPrefix === 'function' ? dbPrefix() : dbPrefix;
  const escapedPrefix = String(resolvedPrefix ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const marker = new RegExp(`(?:^|[\\s"'])--pdd-cli-daemon=${escapedPrefix}-[a-z0-9-]{1,23}(?=$|[\\s"'])`);
  for (const item of processes) {
    const { pid, commandLine } = item;
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) continue;
    if (!isBrowserProcess(item) || typeof commandLine !== 'string' || !marker.test(commandLine)) continue;
    try { kill(pid); count++; }
    catch { /* Best effort; a process may already have exited. */ }
  }
  return count;
}

export function cleanupOrphanBrowsers({ listProcesses = listBrowserProcesses, kill = process.kill } = {}) {
  return reclaimMarkedBrowsers({ listProcesses, kill });
}

/** Create an instance-scoped Live BrowserRuntimePort enforcing ADR-0002 & ADR-0003. */
export function createLiveBrowserRuntime({
  loadChromium: resolveChromium = loadChromium,
  getExecutablePath,
  exists = existsSync,
  platform = process.platform,
  listProcesses = listBrowserProcesses,
  kill = process.kill,
  dbPrefix = daemonBrowserDbPrefix,
  log,
} = {}) {
  const activeSessions = new Set();
  const sessionRecords = new WeakMap();
  const closingBrowsers = new WeakSet();
  const profileMap = new WeakMap();
  let closeAllInFlight = null;

  const resolveLogger = () => log ?? getLogger();
  const resolveExecPath = getExecutablePath ?? (async () => (await resolveChromium()).executablePath());

  function activeRecord(session) {
    const record = session && typeof session === 'object' ? sessionRecords.get(session) : null;
    if (!record || record.closed) throw browserRuntimeError('browser_profile_missing');
    return record;
  }

  async function closeSessionRecord(record) {
    if (!record || record.closed) return;
    record.closed = true;
    activeSessions.delete(record.session);
    await closeBrowserResources(record.browser, {
      closingSet: closingBrowsers,
      profileMap,
    });
  }

  async function checkAvailability() {
    try {
      const execPath = await resolveExecPath();
      return { ok: Boolean(execPath) && exists(execPath), detail: { path: execPath || null } };
    } catch (err) {
      return { ok: false, detail: { error: err?.message || 'chromium 不可用' } };
    }
  }

  async function openSession(options = {}) {
    const launched = await openBrowserWithProfile(options, {
      resolveChromium,
      resolveLogger,
      platform,
      profileMap,
      closingSet: closingBrowsers,
    });

    const record = {
      browser: launched.browser,
      profile: launched.profile,
      closed: false,
      session: null,
    };

    const session = Object.freeze({
      page: launched.page,
      context: launched.context,
      async close() {
        await closeSessionRecord(record);
      },
      async createSnapshotContext(storageState) {
        const current = activeRecord(session);
        assertValidStorageState(storageState, { required: true });
        return createConfiguredContext(current.browser, current.profile, { storageState });
      },
    });

    record.session = session;
    sessionRecords.set(session, record);
    activeSessions.add(session);
    return session;
  }

  async function withSession(optionsOrFn, maybeFn) {
    const hasOptions = typeof optionsOrFn !== 'function';
    const options = hasOptions ? (optionsOrFn ?? {}) : {};
    const fn = hasOptions ? maybeFn : optionsOrFn;
    const session = await openSession(options);
    try {
      return await fn(session);
    } finally {
      try {
        await session.close();
      } catch (err) {
        resolveLogger().warn({ err: err?.message }, 'withSession: cleanup failed');
      }
    }
  }

  async function deriveConsumerContext(session, { storageState, proxy } = {}) {
    const current = activeRecord(session);
    return deriveConsumerFromProfile(current.browser, current.profile, { storageState, proxy });
  }

  async function reclaimOrphans(overrides = {}) {
    return reclaimMarkedBrowsers({
      listProcesses: overrides.listProcesses ?? listProcesses,
      kill: overrides.kill ?? kill,
      dbPrefix: overrides.dbPrefix ?? dbPrefix,
    });
  }

  async function closeAll({ timeoutMs = 5000 } = {}) {
    if (closeAllInFlight) return closeAllInFlight;
    closeAllInFlight = (async () => {
      const snapshot = [...activeSessions];
      await settleWithTimeout(snapshot.map((session) => session.close()), timeoutMs);
    })();
    try {
      return await closeAllInFlight;
    } finally {
      closeAllInFlight = null;
    }
  }

  return Object.freeze({
    checkAvailability,
    withSession,
    openSession,
    deriveConsumerContext,
    reclaimOrphans,
    closeAll,
  });
}
