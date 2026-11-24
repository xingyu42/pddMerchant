import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';
import { hasMallId, readActiveIdFromXhr } from './mall-xhr-probe.js';
import { evaluateInMainWorld } from './browser.js';
import { requireMallId } from './mall-id.js';
import { cssEscape } from './css-escape.js';
import { buildMallContext, resolveTargetPage } from './mall-context.js';

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

export const SWITCHER_TRIGGER_SELECTORS = [
  '[data-testid="mall-switcher"]',
  '[data-testid="shop-switcher"]',
  '[data-testid="mall-select"]',
  '.mall-switcher',
  '.shop-switcher',
  '.mall-select',
  'text=切换店铺',
  'text=店铺',
];

async function readFromState(page, paths) {
  try {
    return await evaluateInMainWorld(page, (ps) => {
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
    return await evaluateInMainWorld(page, (keys) => {
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
    return await evaluateInMainWorld(page, () => {
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

export async function detectLiveMallContext(target, opts = {}) {
  const page = resolveTargetPage(target);
  const { activeProbeReload = false } = opts;
  const activeNameFromState = await readFromState(page, CURRENT_NAME_PATHS);
  const mallListFromState = await readFromState(page, MALL_LIST_PATHS);

  const fromState = await readFromState(page, CURRENT_STATE_PATHS);
  if (hasMallId(fromState)) {
    return buildMallContext({ activeId: fromState, activeName: activeNameFromState, malls: mallListFromState, source: 'state' });
  }

  const fromUrl = await readActiveIdFromUrl(page);
  if (hasMallId(fromUrl)) {
    return buildMallContext({ activeId: fromUrl, activeName: activeNameFromState, malls: mallListFromState, source: 'url' });
  }

  const fromCookie = await readActiveIdFromCookie(page);
  if (hasMallId(fromCookie)) {
    return buildMallContext({ activeId: fromCookie, activeName: activeNameFromState, malls: mallListFromState, source: 'cookie' });
  }

  const fromStorage = await readActiveIdFromStorage(page);
  if (hasMallId(fromStorage)) {
    return buildMallContext({ activeId: fromStorage, activeName: activeNameFromState, malls: mallListFromState, source: 'storage' });
  }

  if (activeProbeReload && typeof page?.reload === 'function') {
    try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }); } catch { /* best-effort */ }
  }

  const fromXhr = await readActiveIdFromXhr(page);
  if (hasMallId(fromXhr)) {
    return buildMallContext({ activeId: fromXhr, activeName: activeNameFromState, malls: mallListFromState, source: 'xhr' });
  }

  const opened = await tryOpenSwitcher(page);
  if (opened) {
    const domMalls = await readMallListFromDom(page);
    try { await page.keyboard?.press?.('Escape'); } catch { /* ignore */ }
    if (domMalls.length > 0) {
      const firstId = domMalls[0]?.mallId ?? domMalls[0]?.id ?? null;
      return buildMallContext({ activeId: firstId, activeName: activeNameFromState, malls: domMalls, source: 'dom' });
    }
  }

  return buildMallContext({ activeId: null, activeName: activeNameFromState, malls: mallListFromState, source: null });
}

async function currentLiveMall(target) {
  const ctx = await detectLiveMallContext(target);
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

export async function listLiveMalls(target) {
  const ctx = await detectLiveMallContext(target);
  if (ctx.malls.length > 0) return ctx.malls;
  if (ctx.activeId) {
    return [{ id: ctx.activeId, name: ctx.activeName, is_current: true }];
  }
  throw new PddCliError({
    code: 'E_MALL_LIST_EMPTY',
    message: '未能获取店铺列表',
    hint: '确认已登录，或手动在浏览器中点击店铺切换下拉确认 UI',
    exitCode: ExitCodes.GENERAL,
  });
}

function optionSelectorsFor(mallId) {
  const id = cssEscape(String(mallId));
  return [
    `[data-testid="mall-option-${id}"]`,
    `[data-mall-id="${id}"]`,
    `[data-id="${id}"]`,
    `.mall-option[data-id="${id}"]`,
    `.shop-option[data-id="${id}"]`,
    `li[data-mall-id="${id}"]`,
  ];
}

async function clickMallOption(page, mallId) {
  const selectors = optionSelectorsFor(mallId);
  for (const sel of selectors) {
    try {
      if (typeof page.locator !== 'function') break;
      const locator = page.locator(sel).first();
      await locator.click({ timeout: 2000 });
      return sel;
    } catch { /* try next */ }
  }

  if (typeof page.getByTestId === 'function') {
    try {
      const locator = page.getByTestId(`mall-option-${mallId}`);
      await locator.click({ timeout: 2000 });
      return 'getByTestId';
    } catch { /* fall through */ }
  }

  return null;
}

export async function switchLiveMall(target, mallId, { strict } = {}) {
  const page = resolveTargetPage(target);
  const validatedId = requireMallId(mallId, { strict });

  const before = await currentLiveMall(page).catch(() => null);
  if (before && before.id === validatedId) return before;

  const opened = await tryOpenSwitcher(page);
  if (!opened) {
    throw new PddCliError({
      code: 'E_MALL_SWITCH_NO_UI',
      message: '未找到店铺切换入口（单店铺账号或 UI 改版）',
      hint: '单店铺账号无需切换；确认当前店铺或升级 mall-switcher selector',
      exitCode: ExitCodes.GENERAL,
    });
  }

  const clicked = await clickMallOption(page, validatedId);
  if (!clicked) {
    try { await page.keyboard?.press?.('Escape'); } catch { /* ignore */ }
    throw new PddCliError({
      code: 'E_MALL_NOT_FOUND',
      message: `未找到店铺 ${validatedId}`,
      hint: '执行 pdd shops list 查看可用店铺',
      exitCode: ExitCodes.USAGE,
    });
  }

  try {
    if (typeof page.waitForLoadState === 'function') {
      await page.waitForLoadState('networkidle', { timeout: 15000 });
    }
  } catch { /* best effort */ }

  const after = await currentLiveMall(page);
  if (after.id !== validatedId) {
    getLogger().warn({ expected: validatedId, actual: after.id }, 'mall switch verification mismatch');
    throw new PddCliError({
      code: 'E_MALL_SWITCH_FAILED',
      message: `店铺切换失败：期望 ${validatedId}，实际 ${after.id}`,
      hint: '重试 pdd shops list 确认目标店铺 ID',
      exitCode: ExitCodes.GENERAL,
    });
  }
  return after;
}

/** Create a Live MallPort using the 6-layer browser probe chain and strict ID validation. */
export function createLiveMallPort() {
  return Object.freeze({
    detectCurrentMall: (target, opts) => detectLiveMallContext(target, opts),
    listMalls: (target) => listLiveMalls(target),
    switchMall: (target, mallId, opts) => switchLiveMall(target, mallId, opts),
  });
}
