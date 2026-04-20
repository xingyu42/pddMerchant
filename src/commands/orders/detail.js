import { launchBrowser, closeBrowser } from '../../adapter/browser.js';
import { isAuthValid } from '../../adapter/auth-state.js';
import { switchTo, currentMall } from '../../adapter/mall-switcher.js';
import { getOrderDetail } from '../../services/orders.js';
import { emit } from '../../infra/output.js';
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { AUTH_STATE_PATH as DEFAULT_AUTH_STATE_PATH } from '../../infra/paths.js';

export async function run(options = {}) {
  const {
    json = false,
    authStatePath = DEFAULT_AUTH_STATE_PATH,
    mall,
    sn,
  } = options;

  const startedAt = Date.now();
  let browser = null;

  try {
    if (!sn) {
      throw new PddCliError({
        code: 'E_USAGE',
        message: 'pdd orders detail 需要 --sn <order_sn>',
        hint: '示例：pdd orders detail --sn 85',
        exitCode: ExitCodes.USAGE,
      });
    }

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

    const result = await getOrderDetail(page, sn, { mallId });

    return emit(
      {
        ok: true,
        command: 'orders.detail',
        data: { order: result.order, mall_id: mallId },
        meta: {
          latency_ms: Date.now() - startedAt,
          xhr_count: 1,
          warnings: ['V0: ORDER_DETAIL 接口未实现，使用 ORDER_LIST 过滤兜底'],
        },
      },
      { json }
    );
  } catch (err) {
    const isCli = err instanceof PddCliError;
    return emit(
      {
        ok: false,
        command: 'orders.detail',
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
