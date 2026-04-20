import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';

const STATE_PATHS = [
  ['__PRELOADED_STATE__', 'mall', 'mallList'],
  ['__PRELOADED_STATE__', 'user', 'mallList'],
  ['__PRELOADED_STATE__', 'account', 'mallList'],
  ['__INITIAL_STATE__', 'mall', 'mallList'],
  ['__INITIAL_STATE__', 'user', 'mallList'],
  ['__INITIAL_STATE__', 'account', 'mallList'],
];

const CURRENT_STATE_PATHS = [
  ['__PRELOADED_STATE__', 'mall', 'currentMallId'],
  ['__PRELOADED_STATE__', 'mall', 'mallId'],
  ['__PRELOADED_STATE__', 'user', 'mallId'],
  ['__INITIAL_STATE__', 'mall', 'currentMallId'],
  ['__INITIAL_STATE__', 'mall', 'mallId'],
  ['__INITIAL_STATE__', 'user', 'mallId'],
  ['__INITIAL_STATE__', 'account', 'mallId'],
];

const CURRENT_NAME_PATHS = [
  ['__PRELOADED_STATE__', 'mall', 'mallName'],
  ['__PRELOADED_STATE__', 'user', 'mallName'],
  ['__INITIAL_STATE__', 'mall', 'mallName'],
  ['__INITIAL_STATE__', 'user', 'mallName'],
];

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

function normalizeMallRecord(raw, activeId) {
  const id = String(raw.mallId ?? raw.mall_id ?? raw.id ?? '');
  const name = String(raw.mallName ?? raw.mall_name ?? raw.name ?? '');
  return {
    id,
    name,
    active: activeId != null && String(activeId) === id,
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

export async function currentMall(page) {
  const fromState = await readFromState(page, CURRENT_STATE_PATHS);
  const fromUrl = await readActiveIdFromUrl(page);
  const fromCookie = await readActiveIdFromCookie(page);
  const id = fromState ?? fromUrl ?? fromCookie;
  if (!id) {
    throw new PddCliError({
      code: 'E_MALL_UNKNOWN',
      message: '无法识别当前店铺',
      hint: '确认已通过 pdd init 登录商家后台',
      exitCode: ExitCodes.AUTH,
    });
  }
  const name = await readFromState(page, CURRENT_NAME_PATHS);
  return { id: String(id), name: typeof name === 'string' ? name : '' };
}

export async function listMalls(page) {
  const activeId = await readFromState(page, CURRENT_STATE_PATHS)
    ?? await readActiveIdFromUrl(page)
    ?? await readActiveIdFromCookie(page);

  const fromState = await readFromState(page, STATE_PATHS);
  if (Array.isArray(fromState) && fromState.length > 0) {
    return fromState
      .map((m) => normalizeMallRecord(m, activeId))
      .filter((m) => m.id);
  }

  const opened = await tryOpenSwitcher(page);
  if (opened) {
    const dom = await readMallListFromDom(page);
    try { await page.keyboard?.press?.('Escape'); } catch { /* ignore */ }
    if (dom.length > 0) {
      return dom
        .map((m) => normalizeMallRecord(m, activeId))
        .filter((m) => m.id);
    }
  }

  if (activeId) {
    const name = await readFromState(page, CURRENT_NAME_PATHS);
    return [{
      id: String(activeId),
      name: typeof name === 'string' ? name : '',
      active: true,
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
