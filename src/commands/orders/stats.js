import { launchBrowser, closeBrowser } from '../../adapter/browser.js';
import { isAuthValid } from '../../adapter/auth-state.js';
import { switchTo, currentMall } from '../../adapter/mall-switcher.js';
import { listOrders, getOrderStats, computeOrderStats } from '../../services/orders.js';
import { emit } from '../../infra/output.js';
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { AUTH_STATE_PATH as DEFAULT_AUTH_STATE_PATH } from '../../infra/paths.js';

export async function run(options = {}) {
  const {
    json = false,
    authStatePath = DEFAULT_AUTH_STATE_PATH,
    mall,
    size = 50,
  } = options;

  const startedAt = Date.now();
  let browser = null;

  try {
    const launched = await launchBrowser({ headed: false, storageStatePath: authStatePath });
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

    let mallId = mall ?? null;
    if (mall) {
      await switchTo(page, mall);
    } else {
      const cur = await currentMall(page).catch(() => null);
      mallId = cur?.mall_id ?? cur?.mallId ?? null;
    }

    const remote = await getOrderStats(page, { mallId });
    const listRes = await listOrders(page, { page: 1, size }, { mallId });
    const local = computeOrderStats(listRes.orders);

    return emit(
      {
        ok: true,
        command: 'orders.stats',
        data: {
          remote: {
            unship: remote.unship,
            unship12h: remote.unship12h,
            delay: remote.delay,
            unreceive: remote.unreceive,
          },
          local,
          mall_id: mallId,
        },
        meta: { latency_ms: Date.now() - startedAt, xhr_count: 2 },
      },
      { json }
    );
  } catch (err) {
    const isCli = err instanceof PddCliError;
    return emit(
      {
        ok: false,
        command: 'orders.stats',
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
