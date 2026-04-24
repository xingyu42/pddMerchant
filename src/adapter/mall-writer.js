import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';
import { isMockEnabled, mockSwitchTo } from './mock-dispatcher.js';
import { currentMall } from './mall-reader.js';
import { requireMallId } from './mall-id.js';
import { cssEscape } from './css-escape.js';

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

export function optionSelectorsFor(mallId) {
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

export async function switchTo(page, mallId) {
  if (isMockEnabled()) return mockSwitchTo(mallId);

  const validatedId = requireMallId(mallId);

  const before = await currentMall(page).catch(() => null);
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

  const after = await currentMall(page);
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
