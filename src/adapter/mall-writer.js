import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';
import { resolveTargetPage } from './mall-context.js';
import { requireMallId } from './mall-id.js';
import { cssEscape } from './css-escape.js';
import { currentLiveMall, tryOpenSwitcher } from './mall-reader.js';

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
  for (const sel of optionSelectorsFor(mallId)) {
    try {
      if (typeof page.locator !== 'function') break;
      await page.locator(sel).first().click({ timeout: 2000 });
      return sel;
    } catch { /* try next */ }
  }

  if (typeof page.getByTestId === 'function') {
    try {
      await page.getByTestId(`mall-option-${mallId}`).click({ timeout: 2000 });
      return 'getByTestId';
    } catch { /* fall through */ }
  }

  return null;
}

export async function switchTo(target, mallId, { strict } = {}) {
  const page = resolveTargetPage(target);
  const validatedId = requireMallId(mallId, { strict });

  const before = await currentLiveMall(page).catch(() => null);
  if (before && before.id === validatedId) return before;

  if (!await tryOpenSwitcher(page)) {
    throw new PddCliError({
      code: 'E_MALL_SWITCH_NO_UI',
      message: '未找到店铺切换入口（单店铺账号或 UI 改版）',
      hint: '单店铺账号无需切换；确认当前店铺或升级 mall-switcher selector',
      exitCode: ExitCodes.GENERAL,
    });
  }

  if (!await clickMallOption(page, validatedId)) {
    try { await page.keyboard?.press?.('Escape'); } catch { /* ignore */ }
    throw new PddCliError({
      code: 'E_MALL_NOT_FOUND',
      message: `未找到店铺 ${validatedId}`,
      hint: '执行 pdd shops list 查看可用店铺',
      exitCode: ExitCodes.USAGE,
    });
  }

  try {
    await page.waitForLoadState?.('networkidle', { timeout: 15000 });
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
