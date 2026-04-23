import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';
import { isMockEnabled, mockListMalls, mockCurrentMall, mockSwitchTo } from './mock-dispatcher.js';

const MALL_LIST_PATHS = [
  ['__PRELOADED_STATE__', 'mall', 'mallList'],
  ['__PRELOADED_STATE__', 'user', 'mallList'],
  ['__PRELOADED_STATE__', 'account', 'mallList'],
  ['__INITIAL_STATE__', 'mall', 'mallList'],
  ['__INITIAL_STATE__', 'user', 'mallList'],
  ['__INITIAL_STATE__', 'account', 'mallList'],
];

const CURRENT_STATE_PATHS = [
  ['__mms', 'user', 'userInfo', '_userInfo', 'mall_id'],
  ['__mms', 'user', 'userInfo', '_userInfo', 'mall', 'mall_id'],
  ['__NEXT_DATA__', 'props', 'userInfo', 'mall_id'],
  ['__NEXT_DATA__', 'props', 'user', 'mallId'],
  ['__NEXT_DATA__', 'props', 'pageProps', 'coreData', 'extra', 'mallId'],
  ['__PRELOADED_STATE__', 'mall', 'currentMallId'],
  ['__PRELOADED_STATE__', 'mall', 'mallId'],
  ['__PRELOADED_STATE__', 'user', 'mallId'],
  ['__INITIAL_STATE__', 'mall', 'currentMallId'],
  ['__INITIAL_STATE__', 'mall', 'mallId'],
  ['__INITIAL_STATE__', 'user', 'mallId'],
  ['__INITIAL_STATE__', 'account', 'mallId'],
];

const CURRENT_NAME_PATHS = [
  ['__NEXT_DATA__', 'props', 'userInfo', 'mall_name'],
  ['__mms', 'user', 'userInfo', '_userInfo', 'mall', 'mall_name'],
  ['__PRELOADED_STATE__', 'mall', 'mallName'],
  ['__PRELOADED_STATE__', 'user', 'mallName'],
  ['__INITIAL_STATE__', 'mall', 'mallName'],
  ['__INITIAL_STATE__', 'user', 'mallName'],
];

const STORAGE_ACTIVE_ID_KEYS = [
  'mallId',
  'mall_id',
  'currentMallId',
  'selectedMallId',
];

const MALL_CONTEXT_HINT =
  '若 pdd doctor 显示已登录但店铺识别失败，可能是 mall-switcher 选择器或状态键已过期；可先用 --mall <id> 手动指定';

const SWITCHER_TRIGGER_SELECTORS = [
  '[data-testid="mall-switcher"]',
  '[data-testid="shop-switcher"]',
  '[data-testid="mall-select"]',
  '.mall-switcher',
  '.shop-switcher',
  '.mall-select',
  'text=切换店铺',
  'text=店铺',
];

function hasMallId(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  return true;
}

function optionSelectorsFor(mallId) {
  const id = String(mallId);
  return [
    `[data-testid="mall-option-${id}"]`,
    `[data-mall-id="${id}"]`,
    `[data-id="${id}"]`,
    `.mall-option[data-id="${id}"]`,
    `.shop-option[data-id="${id}"]`,
    `li[data-mall-id="${id}"]`,
    `text=${id}`,
  ];
}

function readPath(root, path) {
  let cur = root;
  for (const key of path) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

async function readFromState(page, paths) {
  try {
    return await page.evaluate((ps) => {
      const g = globalThis;
      for (const path of ps) {
        let cur = g;
        let ok = true;
        for (const key of path) {
          if (cur == null) { ok = false; break; }
          cur = cur[key];
        }
        if (ok && cur != null) return cur;
      }
      return null;
    }, paths);
  } catch {
    return null;
  }
}

async function readActiveIdFromUrl(page) {
  try {
    const url = new URL(page.url());
    const id = url.searchParams.get('mall_id') || url.searchParams.get('mallId');
    return id || null;
  } catch {
    return null;
  }
}

async function readActiveIdFromCookie(page) {
  try {
    if (typeof page.context !== 'function') return null;
    const ctx = page.context();
    if (!ctx || typeof ctx.cookies !== 'function') return null;
    const cookies = await ctx.cookies();
    const hit = cookies.find((c) => c.name === 'mall_id' || c.name === 'mallId');
    return hit?.value || null;
  } catch {
    return null;
  }
}

async function readActiveIdFromStorage(page) {
  try {
    return await page.evaluate((keys) => {
      for (const key of keys) {
        const localValue = globalThis.localStorage?.getItem?.(key);
        if (typeof localValue === 'string' && localValue.trim().length > 0) return localValue.trim();
        const sessionValue = globalThis.sessionStorage?.getItem?.(key);
        if (typeof sessionValue === 'string' && sessionValue.trim().length > 0) return sessionValue.trim();
      }
      return null;
    }, STORAGE_ACTIVE_ID_KEYS);
  } catch {
    return null;
  }
}

const ACTIVE_ID_RESPONSE_KEYS = ['mall_id', 'mallId', 'currentMallId'];
const PAYLOAD_SEARCH_MAX_DEPTH = 10;

function findActiveIdInPayload(value, seen = new Set(), depth = 0) {
  if (value == null || depth > PAYLOAD_SEARCH_MAX_DEPTH) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findActiveIdInPayload(item, seen, depth + 1);
      if (hasMallId(hit)) return hit;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  if (seen.has(value)) return null;
  seen.add(value);
  for (const key of ACTIVE_ID_RESPONSE_KEYS) {
    if (!Object.hasOwn(value, key)) continue;
    const candidate = value[key];
    if ((typeof candidate === 'string' || typeof candidate === 'number') && hasMallId(candidate)) {
      return candidate;
    }
  }
  for (const nested of Object.values(value)) {
    const hit = findActiveIdInPayload(nested, seen, depth + 1);
    if (hasMallId(hit)) return hit;
  }
  return null;
}

export async function readActiveIdFromXhr(page, { timeoutMs = 3000 } = {}) {
  if (typeof page?.on !== 'function' || typeof page?.off !== 'function') return null;

  let settled = false;
  let resolveProbe;
  let timeoutId = null;

  async function handleResponse(response) {
    if (settled) return;
    try {
      const rawHeaders = typeof response?.headers === 'function' ? response.headers() : response?.headers;
      const headers = rawHeaders instanceof Promise ? await rawHeaders : rawHeaders;
      const contentType = Object.entries(headers ?? {})
        .find(([key]) => key.toLowerCase() === 'content-type')?.[1];
      if (typeof contentType !== 'string' || !contentType.toLowerCase().includes('application/json')) return;

      let body;
      try {
        body = typeof response.json === 'function' ? await response.json() : JSON.parse(await response.text());
      } catch {
        return;
      }

      const hit = findActiveIdInPayload(body);
      if (hasMallId(hit) && !settled) {
        settled = true;
        resolveProbe?.(hit);
      }
    } catch {
      /* best-effort probe: ignore malformed responses */
    }
  }

  try {
    return await new Promise((resolve) => {
      resolveProbe = resolve;
      page.on('response', handleResponse);
      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      }, timeoutMs);
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    try { page.off('response', handleResponse); } catch { /* noop */ }
  }
}

function normalizeMallRecord(raw, activeId) {
  const id = String(raw.mallId ?? raw.mall_id ?? raw.id ?? '');
  const name = String(raw.mallName ?? raw.mall_name ?? raw.name ?? '');
  const isCurrent = activeId != null && String(activeId) === id;
  return {
    id,
    name,
    active: isCurrent,
    is_current: isCurrent,
  };
}

function normalizeMallList(rawList, activeId) {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .map((item) => normalizeMallRecord(item, activeId))
    .filter((mall) => mall.id);
}

function resolveActiveName(activeName, malls, activeId) {
  if (typeof activeName === 'string' && activeName.length > 0) return activeName;
  if (activeId == null || !Array.isArray(malls)) return '';
  const hit = malls.find((mall) => mall.id === String(activeId));
  return typeof hit?.name === 'string' ? hit.name : '';
}

function buildMallContext({ activeId, activeName, malls, source }) {
  const normalizedId = activeId == null ? null : String(activeId);
  const normalizedMalls = normalizeMallList(malls, normalizedId);
  return {
    activeId: normalizedId,
    activeName: resolveActiveName(activeName, normalizedMalls, normalizedId),
    malls: normalizedMalls,
    source: source ?? null,
  };
}

async function tryOpenSwitcher(page) {
  for (const sel of SWITCHER_TRIGGER_SELECTORS) {
    try {
      if (typeof page.locator !== 'function') break;
      const locator = page.locator(sel).first();
      await locator.click({ timeout: 1500 });
      return sel;
    } catch { /* try next */ }
  }
  return null;
}

async function readMallListFromDom(page) {
  try {
    return await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll(
        '[data-testid^="mall-option-"], [data-mall-id], .mall-option, .shop-option, li[data-id]'
      ));
      const out = [];
      for (const el of nodes) {
        const id = el.getAttribute('data-mall-id')
          || el.getAttribute('data-id')
          || (el.getAttribute('data-testid') || '').replace('mall-option-', '');
        if (!id) continue;
        const name = (el.textContent || '').trim();
        out.push({ mallId: id, mallName: name });
      }
      return out;
    });
  } catch {
    return [];
  }
}

export async function resolveMallContext(page, opts = {}) {
  if (isMockEnabled()) {
    const current = await mockCurrentMall();
    const malls = await mockListMalls();
    return buildMallContext({
      activeId: current?.id ?? null,
      activeName: current?.name ?? '',
      malls: Array.isArray(malls) ? malls : [],
      source: 'mock',
    });
  }

  const { activeProbeReload = false } = opts;

  const activeNameFromState = await readFromState(page, CURRENT_NAME_PATHS);
  const mallListFromState = await readFromState(page, MALL_LIST_PATHS);

  const fromState = await readFromState(page, CURRENT_STATE_PATHS);
  if (hasMallId(fromState)) {
    return buildMallContext({
      activeId: fromState,
      activeName: activeNameFromState,
      malls: mallListFromState,
      source: 'state',
    });
  }

  const fromUrl = await readActiveIdFromUrl(page);
  if (hasMallId(fromUrl)) {
    return buildMallContext({
      activeId: fromUrl,
      activeName: activeNameFromState,
      malls: mallListFromState,
      source: 'url',
    });
  }

  const fromCookie = await readActiveIdFromCookie(page);
  if (hasMallId(fromCookie)) {
    return buildMallContext({
      activeId: fromCookie,
      activeName: activeNameFromState,
      malls: mallListFromState,
      source: 'cookie',
    });
  }

  const fromStorage = await readActiveIdFromStorage(page);
  if (hasMallId(fromStorage)) {
    return buildMallContext({
      activeId: fromStorage,
      activeName: activeNameFromState,
      malls: mallListFromState,
      source: 'storage',
    });
  }

  if (activeProbeReload && typeof page?.reload === 'function') {
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch {
      /* best-effort: reload may fail on headless race or slow network; XHR probe still runs */
    }
  }

  const fromXhr = await readActiveIdFromXhr(page);
  if (hasMallId(fromXhr)) {
    return buildMallContext({
      activeId: fromXhr,
      activeName: activeNameFromState,
      malls: mallListFromState,
      source: 'xhr',
    });
  }

  const opened = await tryOpenSwitcher(page);
  if (opened) {
    const domMalls = await readMallListFromDom(page);
    try { await page.keyboard?.press?.('Escape'); } catch { /* ignore */ }
    if (domMalls.length > 0) {
      const firstId = domMalls[0]?.mallId ?? domMalls[0]?.id ?? null;
      return buildMallContext({
        activeId: firstId,
        activeName: activeNameFromState,
        malls: domMalls,
        source: 'dom',
      });
    }
  }

  return buildMallContext({
    activeId: null,
    activeName: activeNameFromState,
    malls: mallListFromState,
    source: null,
  });
}

export async function currentMall(page) {
  if (isMockEnabled()) return mockCurrentMall();
  const ctx = await resolveMallContext(page);
  if (!ctx.activeId) {
    throw new PddCliError({
      code: 'E_MALL_CONTEXT_MISSING',
      message: '无法从商家后台识别当前店铺',
      hint: MALL_CONTEXT_HINT,
      exitCode: ExitCodes.BUSINESS,
    });
  }
  return { id: ctx.activeId, name: ctx.activeName, source: ctx.source };
}

export async function listMalls(page) {
  if (isMockEnabled()) return mockListMalls();
  const ctx = await resolveMallContext(page);
  if (ctx.malls.length > 0) return ctx.malls;
  if (ctx.activeId) {
    return [{
      id: ctx.activeId,
      name: ctx.activeName,
      active: true,
      is_current: true,
    }];
  }
  throw new PddCliError({
    code: 'E_MALL_LIST_EMPTY',
    message: '未能获取店铺列表',
    hint: '确认已登录，或手动在浏览器中点击店铺切换下拉确认 UI',
    exitCode: ExitCodes.GENERAL,
  });
}

async function clickMallOption(page, mallId) {
  for (const sel of optionSelectorsFor(mallId)) {
    try {
      if (typeof page.locator !== 'function') break;
      const locator = page.locator(sel).first();
      await locator.click({ timeout: 2000 });
      return sel;
    } catch { /* try next */ }
  }
  return null;
}

export async function switchTo(page, mallId) {
  if (isMockEnabled()) return mockSwitchTo(mallId);
  const targetId = String(mallId);
  if (!targetId) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: 'switchTo: mallId 必填',
      exitCode: ExitCodes.USAGE,
    });
  }

  const before = await currentMall(page).catch(() => null);
  if (before && before.id === targetId) return before;

  const opened = await tryOpenSwitcher(page);
  if (!opened) {
    throw new PddCliError({
      code: 'E_MALL_SWITCH_NO_UI',
      message: '未找到店铺切换入口（单店铺账号或 UI 改版）',
      hint: '单店铺账号无需切换；确认当前店铺或升级 mall-switcher selector',
      exitCode: ExitCodes.GENERAL,
    });
  }

  const clicked = await clickMallOption(page, targetId);
  if (!clicked) {
    try { await page.keyboard?.press?.('Escape'); } catch { /* ignore */ }
    throw new PddCliError({
      code: 'E_MALL_NOT_FOUND',
      message: `未找到店铺 ${targetId}`,
      hint: '执行 pdd shops list 查看可用店铺',
      exitCode: ExitCodes.USAGE,
    });
  }

  try {
    if (typeof page.waitForLoadState === 'function') {
      await page.waitForLoadState('networkidle', { timeout: 15000 });
    }
  } catch { /* best effort */ }

  const after = await currentMall(page);
  if (after.id !== targetId) {
    getLogger().warn({ expected: targetId, actual: after.id }, 'mall switch verification mismatch');
    throw new PddCliError({
      code: 'E_MALL_SWITCH_FAILED',
      message: `店铺切换失败：期望 ${targetId}，实际 ${after.id}`,
      hint: '重试 pdd shops list 确认目标店铺 ID',
      exitCode: ExitCodes.GENERAL,
    });
  }
  return after;
}

export { readPath };
