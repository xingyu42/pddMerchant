import { launchBrowser, closeBrowser } from '../../adapter/browser.js';
import { isAuthValid } from '../../adapter/auth-state.js';
import { switchTo } from '../../adapter/mall-switcher.js';
import { listGoods } from '../../services/goods.js';
import { emit } from '../../infra/output.js';
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { AUTH_STATE_PATH as DEFAULT_AUTH_STATE_PATH } from '../../infra/paths.js';

export async function run(options = {}) {
  const {
    json = false,
    authStatePath = DEFAULT_AUTH_STATE_PATH,
    mall,
    page: pageNum,
    size,
    status,
    headed = false,
  } = options;

  const startedAt = Date.now();
  let browser = null;

  try {
    const launched = await launchBrowser({
      headed,
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

    let mallCtx = null;
    if (mall) {
      mallCtx = await switchTo(page, mall);
    }

    const result = await listGoods(page, {
      page: pageNum,
      size,
      status,
    }, { mallId: mallCtx?.id });

    return emit(
      {
        ok: true,
        command: 'goods.list',
        data: result.goods,
        meta: {
          latency_ms: Date.now() - startedAt,
          xhr_count: 1,
          total: result.total,
          mall: mallCtx?.id ?? null,
        },
      },
      { json }
    );
  } catch (err) {
    const isCli = err instanceof PddCliError;
    return emit(
      {
        ok: false,
        command: 'goods.list',
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
