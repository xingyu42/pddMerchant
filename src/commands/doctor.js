import { withCommand } from './_runner.js';
import {
  launchBrowser,
  closeBrowser,
  createConsumerContext,
  getBrowserExecutablePath,
} from '../adapter/browser.js';
import { loadAuthState, isConsumerAuthValid } from '../adapter/auth-state.js';
import { assertMerchantVerified } from '../adapter/merchant-auth.js';
import { verifyStoredMerchant } from '../adapter/merchant-auth-storage.js';
import {
  AUTH_STATE_PATH,
  accountAuthStatePath,
} from '../infra/paths.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { existsSync } from 'node:fs';
import { listAccounts } from '../infra/account-registry.js';
import { isMockEnabled } from '../adapter/mock-dispatcher.js';
import { resolveConsumerAccountContext } from '../infra/consumer-account-resolver.js';

export async function checkChromium() {
  if (isMockEnabled()) return { ok: true, detail: { fixture: true } };
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
      return { ok: false, detail: { exists: false } };
    }
    const cookies = Array.isArray(loaded.state?.cookies) ? loaded.state.cookies.length : 0;
    const origins = Array.isArray(loaded.state?.origins) ? loaded.state.origins.length : 0;
    return { ok: true, detail: { exists: true, cookies, origins } };
  } catch (err) {
    return { ok: false, detail: { error: 'auth_state_unreadable' } };
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

async function checkLoginStates(authStatePath, consumerAuthStatePath, task = {}) {
  let browser = null;
  try {
    const launched = await launchBrowser({ headed: false, storageStatePath: authStatePath });
    browser = launched.browser;
    let merchant = { ok: false, detail: { configured: false, verdict: 'not_configured' } };
    if (authStatePath) {
      const loaded = await loadAuthState(authStatePath);
      const result = await verifyStoredMerchant(launched.context, loaded.state, task);
      merchant = { ok: result.verdict === 'verified', detail: {
        configured: true, verdict: result.verdict, reason: result.reason,
        checked_at: result.checked_at, shops: result.identity ? 1 : null,
        mall_source: result.identity ? 'verified_shop_endpoint' : null,
      } };
    }
    const consumer = consumerAuthStatePath
      ? await checkConsumerLoggedIn(browser, consumerAuthStatePath)
      : null;
    return { merchant, consumer };
  } catch (err) {
    return {
      merchant: { ok: false, detail: { configured: Boolean(authStatePath), verdict: 'indeterminate', reason: 'check_failed' } },
      consumer: null,
    };
  } finally {
    await closeBrowser(browser);
  }
}

export function renderDoctor(envelope) {
  const data = envelope?.data ?? {};
  const lines = [`OK  ${envelope?.command || 'doctor'}`];

  lines.push(data.chromium?.ok ? '✓ Chromium 可用' : '· Chromium 不可用');
  lines.push(data.auth_file?.ok ? '✓ 商家端凭据可用' : '· 商家端凭据未配置或损坏');

  const shops = data.logged_in?.detail?.shops;
  const shopSummary = Number.isInteger(shops) ? `（${shops} 个店铺）` : '';
  const verdict = data.logged_in?.detail?.verdict;
  lines.push(data.logged_in?.ok ? `✓ 商家端登录态有效${shopSummary}`
    : data.logged_in?.detail?.reason === 'identity_mismatch' ? '· 商家端店铺绑定不一致'
      : verdict === 'rejected' ? '· 商家端登录态已失效'
      : verdict === 'not_configured' ? '· 商家端未配置' : '· 商家端登录态无法判定');

  if (data.consumer_auth_file?.ok === true && data.consumer_logged_in?.ok === true) {
    lines.push('✓ 用户端登录态有效');
  } else {
    lines.push('· 用户端未配置');
  }

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
    const consumerAccount = await resolveConsumerAccountContext({ account: ctx.config?.consumerAccount });
    const consumerAuthStatePath = consumerAccount.authPath;

    const data = {
      chromium: { ok: false, detail: null },
      auth_file: { ok: false, detail: null },
      logged_in: { ok: false, detail: null },
      consumer_auth_file: { ok: false, detail: null },
      consumer_logged_in: { ok: false, detail: { configured: false } },
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
      data.auth_file.ok ? authStatePath : null,
      data.consumer_auth_file.ok ? consumerAuthStatePath : null,
      { signal: ctx.signal, deadlineAt: ctx.deadlineAt ?? undefined, expectedMallId: ctx.account?.mallId }
    );
    data.logged_in = loginStates.merchant;
    if (loginStates.consumer) data.consumer_logged_in = loginStates.consumer;
    if (!data.auth_file.ok) {
      throw new PddCliError({
        code: 'E_AUTH_STATE_MISSING',
        message: '登录凭据缺失或损坏',
        hint: '执行 pdd init 完成首次授权',
        detail: data,
        exitCode: ExitCodes.AUTH,
      });
    }
    if (!data.logged_in.ok) {
      ctx.log.debug({ detail: data.logged_in.detail }, 'logged_in check failed');
      assertMerchantVerified(data.logged_in.detail, { detail: data });
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
