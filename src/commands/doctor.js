import { chromium } from 'playwright';
import { launchBrowser, closeBrowser } from '../adapter/browser.js';
import { loadAuthState, isAuthValid } from '../adapter/auth-state.js';
import { resolveMallContext } from '../adapter/mall-switcher.js';
import { emit } from '../infra/output.js';
import { getLogger } from '../infra/logger.js';
import { AUTH_STATE_PATH as DEFAULT_AUTH_STATE_PATH } from '../infra/paths.js';

async function checkChromium() {
  try {
    const execPath = chromium.executablePath();
    return { ok: Boolean(execPath), detail: { path: execPath || null } };
  } catch (err) {
    return { ok: false, detail: { error: err?.message || 'chromium 不可用' } };
  }
}

async function checkAuthFile(path) {
  try {
    const loaded = await loadAuthState(path);
    if (!loaded.exists) {
      return { ok: false, detail: { path, exists: false } };
    }
    const cookies = Array.isArray(loaded.state?.cookies) ? loaded.state.cookies.length : 0;
    const origins = Array.isArray(loaded.state?.origins) ? loaded.state.origins.length : 0;
    return { ok: true, detail: { path, exists: true, cookies, origins } };
  } catch (err) {
    return { ok: false, detail: { path, error: err?.message || '解析失败' } };
  }
}

async function detectShopCount(page) {
  try {
    const ctx = await resolveMallContext(page);
    if (Array.isArray(ctx?.malls) && ctx.malls.length > 0) return ctx.malls.length;
    if (ctx?.activeId) return 1;
    return null;
  } catch {
    return null;
  }
}

async function checkLoggedIn(authStatePath) {
  let browser = null;
  try {
    const launched = await launchBrowser({ headed: false, storageStatePath: authStatePath });
    browser = launched.browser;
    const valid = await isAuthValid(launched.page);
    const url = launched.page.url();
    let shops = null;
    if (valid) {
      shops = await detectShopCount(launched.page);
    }
    return { ok: valid, detail: { url, shops } };
  } catch (err) {
    return { ok: false, detail: { error: err?.message || '导航失败' } };
  } finally {
    await closeBrowser(browser);
  }
}

export async function run(options = {}) {
  const { json = false, authStatePath = DEFAULT_AUTH_STATE_PATH } = options;
  const log = getLogger();
  const startedAt = Date.now();

  const data = {
    chromium: { ok: false, detail: null },
    auth_file: { ok: false, detail: null },
    logged_in: { ok: false, detail: null },
  };

  data.chromium = await checkChromium();
  if (!data.chromium.ok) {
    return emit(
      {
        ok: false,
        command: 'doctor',
        data,
        error: {
          code: 'E_CHROMIUM_MISSING',
          message: 'Chromium 未安装',
          hint: '执行 npx playwright install chromium',
        },
        meta: { latency_ms: Date.now() - startedAt },
      },
      { json }
    );
  }

  data.auth_file = await checkAuthFile(authStatePath);
  if (!data.auth_file.ok) {
    return emit(
      {
        ok: false,
        command: 'doctor',
        data,
        error: {
          code: 'E_AUTH_STATE_MISSING',
          message: '登录凭据缺失或损坏',
          hint: '执行 pdd init 完成首次授权',
        },
        meta: { latency_ms: Date.now() - startedAt },
      },
      { json }
    );
  }

  data.logged_in = await checkLoggedIn(authStatePath);
  if (!data.logged_in.ok) {
    log.debug({ detail: data.logged_in.detail }, 'logged_in check failed');
    return emit(
      {
        ok: false,
        command: 'doctor',
        data,
        error: {
          code: 'E_AUTH_EXPIRED',
          message: '登录态已过期',
          hint: '执行 pdd login 重新登录',
        },
        meta: { latency_ms: Date.now() - startedAt },
      },
      { json }
    );
  }

  return emit(
    {
      ok: true,
      command: 'doctor',
      data,
      meta: { latency_ms: Date.now() - startedAt },
    },
    { json }
  );
}

export default run;
export { DEFAULT_AUTH_STATE_PATH };
