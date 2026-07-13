import { withCommand } from './_runner.js';
import {
  launchBrowser,
  closeBrowser,
  createConsumerContext,
  getBrowserExecutablePath,
} from '../adapter/browser.js';
import { loadAuthState, isAuthValid, isConsumerAuthValid } from '../adapter/auth-state.js';
import { resolveMallContext } from '../adapter/mall-reader.js';
import {
  AUTH_STATE_PATH,
  CONSUMER_AUTH_STATE_PATH,
  DAEMON_STATE_PATH,
  accountAuthStatePath,
} from '../infra/paths.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { existsSync, readFileSync } from 'node:fs';
import { isPidAlive } from '../infra/process-util.js';
import { listAccounts } from '../infra/account-registry.js';
import { isMockEnabled } from '../adapter/mock-dispatcher.js';

function checkDaemon() {
  if (!existsSync(DAEMON_STATE_PATH)) {
    return { ok: false, detail: { running: false } };
  }
  try {
    const state = JSON.parse(readFileSync(DAEMON_STATE_PATH, 'utf8'));
    const pid = state?.pid;
    if (typeof pid !== 'number') return { ok: false, detail: { running: false } };
    const alive = isPidAlive(pid);
    return {
      ok: alive,
      detail: {
        running: alive,
        pid,
        lastRefreshAt: state.lastRefreshAt || null,
        lastResult: state.lastResult || null,
      },
    };
  } catch {
    return { ok: false, detail: { running: false, error: 'state file corrupt' } };
  }
}

export async function checkChromium() {
  try {
    const execPath = getBrowserExecutablePath();
    return { ok: Boolean(execPath) && existsSync(execPath), detail: { path: execPath || null } };
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

async function detectShopContext(page, opts = {}) {
  try {
    const ctx = await resolveMallContext(page, opts);
    const shops = (Array.isArray(ctx?.malls) && ctx.malls.length > 0)
      ? ctx.malls.length
      : (ctx?.activeId ? 1 : null);
    return { shops, source: ctx?.source ?? null };
  } catch {
    return { shops: null, source: null };
  }
}

async function checkConsumerLoggedIn(browser, authStatePath) {
  let consumer = null;
  try {
    if (isMockEnabled()) {
      const valid = await isConsumerAuthValid(null);
      return { ok: valid, detail: { url: null } };
    }

    consumer = await createConsumerContext(browser, { storageStatePath: authStatePath });
    const valid = await isConsumerAuthValid(consumer.page);
    return { ok: valid, detail: { url: consumer.page.url() } };
  } catch (err) {
    return { ok: false, detail: { error: err?.message || '消费端导航失败' } };
  } finally {
    await consumer?.close();
  }
}

async function checkLoginStates(authStatePath, consumerAuthStatePath, mallProbeOpts) {
  let browser = null;
  try {
    const launched = await launchBrowser({ headed: false, storageStatePath: authStatePath });
    browser = launched.browser;
    const valid = await isAuthValid(launched.page);
    const url = launched.page.url();
    let shops = null;
    let source = null;
    if (valid) {
      const ctx = await detectShopContext(launched.page, mallProbeOpts);
      shops = ctx.shops;
      source = ctx.source;
    }
    const merchant = { ok: valid, detail: { url, shops, mall_source: source } };
    const consumer = valid && consumerAuthStatePath
      ? await checkConsumerLoggedIn(browser, consumerAuthStatePath)
      : null;
    return { merchant, consumer };
  } catch (err) {
    return {
      merchant: { ok: false, detail: { error: err?.message || '导航失败' } },
      consumer: null,
    };
  } finally {
    await closeBrowser(browser);
  }
}

export function renderDoctor(envelope) {
  const data = envelope?.data ?? {};
  const lines = [`OK  ${envelope?.command || 'doctor'}`];

  lines.push('✓ Chromium 可用');
  lines.push('✓ 商家端凭据可用');

  const shops = data.logged_in?.detail?.shops;
  const shopSummary = Number.isInteger(shops) ? `（${shops} 个店铺）` : '';
  lines.push(`✓ 商家端登录态有效${shopSummary}`);

  if (data.consumer_auth_file?.ok === true && data.consumer_logged_in?.ok === true) {
    lines.push('✓ 用户端登录态有效');
  } else {
    lines.push('· 用户端未配置');
  }

  const daemonRunning = data.daemon?.detail?.running === true;
  lines.push(`${daemonRunning ? '✓' : '·'} 后台续期${daemonRunning ? '运行中' : '未运行'}`);

  if (Array.isArray(data.accounts)) {
    const validAccounts = data.accounts.filter((account) => account?.auth_file?.ok === true).length;
    lines.push(`账号凭据 ${validAccounts}/${data.accounts.length} 可用`);
  }

  return lines.join('\n');
}

export const run = withCommand({
  name: 'doctor',
  needsAuth: false,
  needsMall: 'none',
  render: renderDoctor,
  async run(ctx) {
    const authStatePath = ctx.authPath ?? AUTH_STATE_PATH;
    const consumerAuthStatePath = process.env.PDD_CONSUMER_AUTH_STATE_PATH || CONSUMER_AUTH_STATE_PATH;
    const probe = ctx.config?.probe ?? null;
    const mallProbeOpts = probe === 'xhr' ? { activeProbeReload: true } : {};

    const data = {
      chromium: { ok: false, detail: null },
      auth_file: { ok: false, detail: null },
      logged_in: { ok: false, detail: null },
      consumer_auth_file: { ok: false, detail: null },
      consumer_logged_in: { ok: false, detail: { configured: false } },
      daemon: checkDaemon(),
    };

    data.chromium = await checkChromium();
    if (!data.chromium.ok) {
      throw new PddCliError({
        code: 'E_CHROMIUM_MISSING',
        message: 'Chromium 未安装',
        hint: '执行 npx patchright install chromium',
        detail: data,
        exitCode: ExitCodes.GENERAL,
      });
    }

    data.auth_file = await checkAuthFile(authStatePath);
    if (!data.auth_file.ok) {
      throw new PddCliError({
        code: 'E_AUTH_STATE_MISSING',
        message: '登录凭据缺失或损坏',
        hint: '执行 pdd init 完成首次授权',
        detail: data,
        exitCode: ExitCodes.AUTH,
      });
    }

    data.consumer_auth_file = await checkAuthFile(consumerAuthStatePath);
    const consumerFileMissing = data.consumer_auth_file.detail?.exists === false;
    if (!data.consumer_auth_file.ok && !consumerFileMissing) {
      throw new PddCliError({
        code: 'E_CONSUMER_AUTH_STATE_INVALID',
        message: '用户端登录凭据损坏',
        hint: '执行 pdd login --consumer 重新授权',
        detail: data,
        exitCode: ExitCodes.AUTH,
      });
    }

    const loginStates = await checkLoginStates(
      authStatePath,
      data.consumer_auth_file.ok ? consumerAuthStatePath : null,
      mallProbeOpts
    );
    data.logged_in = loginStates.merchant;
    if (loginStates.consumer) data.consumer_logged_in = loginStates.consumer;
    if (!data.logged_in.ok) {
      ctx.log.debug({ detail: data.logged_in.detail }, 'logged_in check failed');
      throw new PddCliError({
        code: 'E_AUTH_EXPIRED',
        message: '登录态已过期',
        hint: '执行 pdd login 重新登录',
        detail: data,
        exitCode: ExitCodes.AUTH,
      });
    }

    if (data.consumer_auth_file.ok && !data.consumer_logged_in.ok) {
      ctx.log.debug({ detail: data.consumer_logged_in.detail }, 'consumer_logged_in check failed');
      throw new PddCliError({
        code: 'E_CONSUMER_AUTH_EXPIRED',
        message: '用户端登录态已过期',
        hint: '执行 pdd login --consumer 重新登录',
        detail: data,
        exitCode: ExitCodes.AUTH,
      });
    }

    const accounts = await listAccounts().catch(() => []);
    if (accounts.length > 0) {
      data.accounts = [];
      for (const acct of accounts) {
        const acctAuthPath = accountAuthStatePath(acct.slug);
        const fileCheck = await checkAuthFile(acctAuthPath);
        data.accounts.push({
          slug: acct.slug,
          displayName: acct.displayName,
          auth_file: fileCheck,
          hasCredential: acct.credential != null,
        });
      }
    }

    return data;
  },
});

export default run;
