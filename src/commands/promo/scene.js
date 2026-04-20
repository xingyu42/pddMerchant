import { launchBrowser, closeBrowser } from '../../adapter/browser.js';
import { isAuthValid } from '../../adapter/auth-state.js';
import { currentMall, switchTo } from '../../adapter/mall-switcher.js';
import { getScenePromo } from '../../services/promo.js';
import { emit } from '../../infra/output.js';
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { AUTH_STATE_PATH as DEFAULT_AUTH_STATE_PATH } from '../../infra/paths.js';

export async function run(options = {}) {
  const {
    json = false,
    mall,
    page: pageNum,
    size,
    since,
    authStatePath = DEFAULT_AUTH_STATE_PATH,
  } = options;

  const startedAt = Date.now();
  let browser = null;

  try {
    const launched = await launchBrowser({
      headed: false,
      storageStatePath: authStatePath,
    });
    browser = launched.browser;
    const { page } = launched;

    const valid = await isAuthValid(page);
    if (!valid) {
      throw new PddCliError({
        code: 'E_AUTH_EXPIRED',
        message: '登录态已过期或缺失',
        hint: '执行 pdd login 重新登录',
        exitCode: ExitCodes.AUTH,
      });
    }

    let mallCtx = await currentMall(page).catch(() => null);
    if (mall && (!mallCtx || mallCtx.id !== String(mall))) {
      mallCtx = await switchTo(page, mall);
    }
    const mallId = mallCtx?.id;

    const result = await getScenePromo(page, {
      mallId,
      page: pageNum,
      size,
      since,
    });

    return emit(
      {
        ok: true,
        command: 'promo.scene',
        data: {
          mallId,
          entities: result.entities,
          totals: result.totals,
          count: result.entities.length,
        },
        meta: { latency_ms: Date.now() - startedAt },
      },
      { json }
    );
  } catch (err) {
    const isCli = err instanceof PddCliError;
    return emit(
      {
        ok: false,
        command: 'promo.scene',
        error: {
          code: isCli ? err.code : 'E_GENERAL',
          message: isCli ? err.message : err?.message || '未知错误',
          hint: isCli ? err.hint : '',
        },
        meta: { latency_ms: Date.now() - startedAt },
      },
      { json }
    );
  } finally {
    await closeBrowser(browser);
  }
}

export default run;
export { DEFAULT_AUTH_STATE_PATH };
