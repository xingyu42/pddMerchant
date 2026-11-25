import { lstat, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadAuthState as defaultLoadAuthState } from '../adapter/auth-state.js';
import { listAccounts as defaultListAccounts } from '../infra/account-store.js';
import { assertMerchantVerified } from '../infra/auth-task.js';
import { resolveConsumerAccountContext as defaultResolveConsumerAccount } from '../infra/consumer-account-resolver.js';
import { getDatabasePath } from '../infra/db.js';
import { PddCliError, ExitCodes, secretDecryptFailed } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';
import { getReloginSummary as defaultGetReloginSummary } from './relogin-policy.js';
import { toDoctorView } from './views/auth.js';
import { formatPasswordReloginStatus } from './views/labels.js';

const LEGACY_STORAGE_MESSAGE = '检测到旧版数据，已不再使用，可手动删除';

async function statEntry(path) {
  try {
    return await lstat(path);
  } catch {
    return null;
  }
}

async function hasLegacyAccountData(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    if (entries.some((entry) => entry.name === 'registry.json' && entry.isFile())) return true;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const state = await statEntry(join(path, entry.name, 'auth-state.json'));
      if (state?.isFile()) return true;
    }
  } catch {
    /* 旧数据检查失败视为未发现。 */
  }
  return false;
}

/** Check level-1 non-symlink legacy file storage beside the SQLite database without reading contents. */
export async function hasLegacyStorage() {
  const base = dirname(getDatabasePath());
  if (!(await statEntry(base))?.isDirectory()) return false;
  for (const [kind, directory] of [['merchant', 'stores'], ['consumer', 'accounts']]) {
    const parent = join(base, kind);
    if (!(await statEntry(parent))?.isDirectory()) continue;
    const path = join(parent, directory);
    if (!(await statEntry(path))?.isDirectory()) continue;
    if (await hasLegacyAccountData(path)) return true;
  }
  return false;
}

function createInitialDoctorData(legacyStorage) {
  return {
    ...(legacyStorage ? { headline: [LEGACY_STORAGE_MESSAGE] } : {}),
    chromium: { ok: false, detail: null },
    auth_file: { ok: false, detail: null },
    logged_in: { ok: false, detail: null },
    password_relogin: { has_password: false, status: null },
    consumer_auth_file: { ok: false, detail: null },
    consumer_logged_in: { ok: false, detail: { configured: false } },
  };
}

function normalizeMerchantInput(options = {}) {
  const input = options.account;
  if (!input) {
    return {
      accountId: options.accountId ?? null,
      slug: options.accountSlug ?? null,
      expectedMallId: options.expectedMallId,
    };
  }
  const account = input.account ?? input;
  return {
    accountId: input.accountId ?? account.id ?? options.accountId ?? null,
    slug: input.slug ?? account.slug ?? options.accountSlug ?? null,
    expectedMallId: options.expectedMallId ?? account.identity,
  };
}

async function resolveConsumerInput(consumerAccount, resolveConsumer) {
  if (consumerAccount && typeof consumerAccount === 'object') {
    return {
      accountId: consumerAccount.accountId ?? consumerAccount.id ?? null,
      slug: consumerAccount.slug ?? null,
    };
  }
  return resolveConsumer({ account: consumerAccount, needsAuth: false });
}

function checkPasswordRelogin(accountId, getReloginSummary) {
  const summary = accountId == null ? null : getReloginSummary(accountId);
  return {
    has_password: Boolean(summary?.has_password),
    status: formatPasswordReloginStatus(summary),
  };
}

async function checkChromiumAvailability(browser) {
  try {
    return await browser.checkAvailability();
  } catch (err) {
    return { ok: false, detail: { error: err?.message || 'chromium 不可用' } };
  }
}

function inspectAuthFile(accountId, accountDetail, loadAuthState) {
  try {
    const loaded = loadAuthState(accountId);
    if (!loaded.exists) {
      return { check: { ok: false, detail: { exists: false } }, state: null };
    }
    const cookies = Array.isArray(loaded.state?.cookies) ? loaded.state.cookies.length : 0;
    const origins = Array.isArray(loaded.state?.origins) ? loaded.state.origins.length : 0;
    return { check: { ok: true, detail: { exists: true, cookies, origins } }, state: loaded.state };
  } catch (err) {
    if (err?.code === 'E_SECRET_DECRYPT_FAILED') throw secretDecryptFailed(accountDetail);
    if (err?.code?.startsWith('E_MASTER_KEY_')) throw err;
    return { check: { ok: false, detail: { error: 'auth_state_unreadable' } }, state: null };
  }
}

function assertDoctorStorage(data) {
  const consumerMissing = data.consumer_auth_file.detail?.exists === false;
  if (!data.consumer_auth_file.ok && !consumerMissing) {
    throw new PddCliError({
      code: 'E_CONSUMER_AUTH_STATE_INVALID',
      message: '用户端登录态文件损坏',
      hint: '执行 pdd login --consumer 重新授权',
      detail: data,
      exitCode: ExitCodes.AUTH,
    });
  }
}

async function verifyMerchantSession({ auth, session, merchant, merchantLoaded, signal, deadlineAt }) {
  if (merchant.accountId == null || !merchantLoaded.check.ok) {
    return { ok: false, detail: { configured: false, verdict: 'not_configured' } };
  }
  const result = await auth.verifyAndSeal(session, {
    state: merchantLoaded.state,
    signal,
    deadlineAt,
    expectedMallId: merchant.expectedMallId,
  });
  return {
    ok: result.verdict === 'verified',
    detail: {
      configured: true,
      verdict: result.verdict,
      reason: result.reason,
      checked_at: result.checked_at,
      shops: result.identity ? 1 : null,
      mall_source: result.identity ? 'verified_shop_endpoint' : null,
    },
  };
}

async function checkConsumerSession({ browser, auth, session, consumerState, signal, deadlineAt }) {
  let consumer = null;
  try {
    consumer = await browser.deriveConsumerContext(session, { storageState: consumerState });
    const result = await auth.checkConsumerOnline(consumer.page, { signal, deadlineAt });
    return { ok: Boolean(result?.ok), detail: { url: result?.detail?.url ?? null } };
  } catch (err) {
    return { ok: false, detail: { error: err?.message || '消费端导航失败' } };
  } finally {
    await consumer?.close();
  }
}

async function runBrowserChecks({
  browser,
  auth,
  merchant,
  merchantLoaded,
  consumerAccount,
  consumerLoaded,
  signal,
  deadlineAt,
}) {
  if (!merchantLoaded.check.ok && !consumerLoaded.check.ok) {
    return {
      merchant: { ok: false, detail: { configured: false, verdict: 'not_configured' } },
      consumer: null,
    };
  }
  try {
    return await browser.withSession(
      { headed: false, storageState: merchantLoaded.state ?? undefined },
      async (session) => {
        const merchantCheck = await verifyMerchantSession({
          auth, session, merchant, merchantLoaded, signal, deadlineAt,
        });
        const consumerCheck = consumerAccount.accountId != null && consumerLoaded.check.ok
          ? await checkConsumerSession({
              browser, auth, session, consumerState: consumerLoaded.state, signal, deadlineAt,
            })
          : null;
        return { merchant: merchantCheck, consumer: consumerCheck };
      },
    );
  } catch {
    return {
      merchant: {
        ok: false,
        detail: {
          configured: merchant.accountId != null && merchantLoaded.check.ok,
          verdict: 'indeterminate',
          reason: 'check_failed',
        },
      },
      consumer: null,
    };
  }
}

function assertDoctorLogin(data, log) {
  if (!data.auth_file.ok) {
    throw new PddCliError({
      code: 'E_AUTH_STATE_MISSING',
      message: '登录态文件缺失或损坏',
      hint: '执行 pdd init 完成首次授权',
      detail: data,
      exitCode: ExitCodes.AUTH,
    });
  }
  if (!data.logged_in.ok) {
    log.debug({ detail: data.logged_in.detail }, 'logged_in check failed');
    assertMerchantVerified(data.logged_in.detail, { detail: data });
  }
  if (data.consumer_auth_file.ok && !data.consumer_logged_in.ok) {
    log.debug({ detail: data.consumer_logged_in.detail }, 'consumer_logged_in check failed');
    throw new PddCliError({
      code: 'E_CONSUMER_AUTH_EXPIRED',
      message: '用户端登录态已过期',
      hint: '执行 pdd login --consumer 重新登录',
      detail: data,
      exitCode: ExitCodes.AUTH,
    });
  }
}

function checkDoctorAccounts({ loadAuthState, listAccounts, getReloginSummary }) {
  const checks = [];
  for (const account of listAccounts({ kind: 'merchant' })) {
    let authFile;
    try {
      authFile = inspectAuthFile(account.id, undefined, loadAuthState).check;
    } catch (error) {
      if (error?.code !== 'E_SECRET_DECRYPT_FAILED') throw error;
      authFile = { ok: false, detail: { error: 'auth_state_undecryptable' } };
    }
    checks.push({
      slug: account.slug,
      displayName: account.display_name,
      auth_file: authFile,
      relogin: getReloginSummary(account.id),
    });
  }
  return checks;
}

function resolveDependencies(deps) {
  const browser = deps.browser ?? deps.browserRuntime;
  const auth = deps.auth ?? deps.authPort;
  if (!browser || !auth) {
    throw new PddCliError({
      code: 'E_CONFIG_INVALID',
      message: 'diagnoseEnvironment 需要 BrowserRuntimePort 与 AuthPort',
      exitCode: ExitCodes.GENERAL,
    });
  }
  return {
    browser,
    auth,
    log: deps.log ?? getLogger(),
    loadAuthState: deps.loadAuthState ?? defaultLoadAuthState,
    listAccounts: deps.listAccounts ?? defaultListAccounts,
    getReloginSummary: deps.getReloginSummary ?? defaultGetReloginSummary,
    resolveConsumer: deps.resolveConsumerAccount ?? defaultResolveConsumerAccount,
    checkLegacyStorage: deps.hasLegacyStorage ?? hasLegacyStorage,
  };
}

async function assertChromiumAvailable(browser, data) {
  data.chromium = await checkChromiumAvailability(browser);
  if (!data.chromium?.ok) {
    throw new PddCliError({
      code: 'E_CHROMIUM_MISSING',
      message: 'Chromium 未安装',
      hint: '执行 npx patchright install chromium',
      detail: data,
      exitCode: ExitCodes.GENERAL,
    });
  }
}

/** Run ordered read-only environment diagnostics and return a pure DoctorReport value. */
export async function diagnoseEnvironment(options = {}, deps = {}) {
  const resolved = resolveDependencies(deps);
  const legacyStorage = await resolved.checkLegacyStorage();
  const warnings = legacyStorage ? [{ code: 'legacy_storage_detected' }] : [];
  const data = createInitialDoctorData(legacyStorage);

  try {
    const merchant = normalizeMerchantInput(options);
    data.password_relogin = checkPasswordRelogin(merchant.accountId, resolved.getReloginSummary);
    const consumerAccount = await resolveConsumerInput(options.consumerAccount, resolved.resolveConsumer);
    await assertChromiumAvailable(resolved.browser, data);

    const merchantLoaded = inspectAuthFile(merchant.accountId, { slug: merchant.slug, kind: 'merchant' }, resolved.loadAuthState);
    const consumerLoaded = inspectAuthFile(consumerAccount.accountId, { slug: consumerAccount.slug, kind: 'consumer' }, resolved.loadAuthState);
    data.auth_file = merchantLoaded.check;
    data.consumer_auth_file = consumerLoaded.check;
    assertDoctorStorage(data);

    const loginStates = await runBrowserChecks({
      browser: resolved.browser,
      auth: resolved.auth,
      merchant,
      merchantLoaded,
      consumerAccount,
      consumerLoaded,
      signal: options.signal,
      deadlineAt: options.deadlineAt,
    });
    data.logged_in = loginStates.merchant;
    if (loginStates.consumer) data.consumer_logged_in = loginStates.consumer;
    assertDoctorLogin(data, resolved.log);

    const accounts = checkDoctorAccounts(resolved);
    if (accounts.length > 0) data.accounts = accounts;
    const view = toDoctorView(data);
    if (legacyStorage) view.headline.push(LEGACY_STORAGE_MESSAGE);
    return { ok: true, view, raw: data, warnings, failure: null };
  } catch (failure) {
    return { ok: false, view: null, raw: data, warnings, failure };
  }
}
