import { hasPasswordCredential, loadPasswordCredential, savePasswordCredential, deletePasswordCredential } from '../adapter/password-credential.js';
import { assertMerchantVerified, verifyMerchantContext } from '../adapter/merchant-auth.js';
import { createSnapshotContext } from '../adapter/browser.js';
import { attemptPasswordLogin } from '../adapter/password-login.js';
import { loadAuthState, saveAuthStateSnapshot } from '../adapter/auth-state.js';
import { withMerchantAuthUpdate, commitMerchantCandidate, assertAuthTask } from '../adapter/merchant-auth-storage.js';
import { mockPasswordLogin } from '../adapter/mock-dispatcher.js';
import { getAccountById, getCredential, getReloginState, putReloginState,
  ensureOpenPendingAction, resolveOpenPendingActions, listPendingActions } from '../infra/account-store.js';
import { transaction, isInTransaction } from '../infra/db.js';
import { assertLeaseOwner, renewLease } from '../infra/leases.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { getLogger } from '../infra/logger.js';
import { getMasterKey } from '../infra/master-key.js';
import { isoToLocalDateTime } from '../infra/units.js';
import { PddCliError, ExitCodes, authHumanRequired, reloginBlocked, reloginFailed, passwordLoginFormChanged } from '../infra/errors.js';

const CHALLENGES = new Set(['sms', 'slider', 'click', 'risk_confirm', 'unknown']);
const OUTCOMES = Object.freeze({
  success: { status: 'available', reason: 'success' },
  challenge: { status: 'awaiting_human', kind: 'human_takeover' },
  wrong_password: { status: 'blocked', reason: 'wrong_password', kind: 'relogin_blocked' },
  account_locked: { status: 'blocked', reason: 'account_locked', kind: 'relogin_blocked' },
  form_changed: { status: 'available', reason: 'form_changed' },
  network_error: { status: 'available', reason: 'network_error' },
  verify_failed: { status: 'available', reason: 'verify_failed' },
});

function write(callback) {
  try { return isInTransaction() ? callback() : transaction(callback); }
  catch (error) {
    if (error instanceof PddCliError) throw error;
    throw new PddCliError({ code: 'E_AUTH_ACCOUNT_SAVE_FAILED', message: '账号重登状态存储暂不可用', exitCode: ExitCodes.AUTH });
  }
}

function merchantAccount(accountId) {
  const account = getAccountById(accountId);
  if (!account || account.kind !== 'merchant') {
    throw new PddCliError({ code: 'E_ACCOUNT_NOT_FOUND', message: '商家账号不存在', exitCode: ExitCodes.USAGE });
  }
  return account;
}

function updateState(accountId, changes) {
  const previous = getReloginState(accountId);
  putReloginState(accountId, {
    status: previous?.status ?? 'available', reason: previous?.reason ?? null,
    consecutiveTakeoverTimeouts: previous?.consecutive_takeover_timeouts ?? 0,
    lastAttemptAt: previous?.last_attempt_at ?? null, ...changes,
  });
}

function authExpired(detail, authResult = { verdict: 'rejected', reason: 'auth_missing' }) {
  try { assertMerchantVerified(authResult, { detail }); }
  catch (error) { return error; }
}

function throttleError(account, state, minIntervalMs) {
  const detail = { account: account.slug, reason: state.reason,
    relogin: 'throttled', next_attempt_at: isoToLocalDateTime(new Date(Date.parse(state.last_attempt_at) + minIntervalMs).toISOString()) };
  if (state.reason === 'success') return authExpired(detail);
  if (state.reason === 'form_changed') return passwordLoginFormChanged(detail);
  return reloginFailed(detail);
}

export function decideRelogin(accountId, { now = Date.now(), minIntervalMs, authResult }) {
  if (!hasPasswordCredential(accountId)) return { action: 'fail', error: authExpired(undefined, authResult) };
  const account = merchantAccount(accountId);
  const state = getReloginState(accountId);
  if (state?.status === 'blocked') return { action: 'fail', error: reloginBlocked({ account: account.slug, reason: state.reason }) };
  if (state?.status === 'awaiting_human') return { action: 'fail', error: authHumanRequired({ account: account.slug, challenge: state.reason }) };
  const intervalMs = Number.isFinite(minIntervalMs) && minIntervalMs > 0 ? minIntervalMs : 1_800_000;
  if (state?.last_attempt_at && now - Date.parse(state.last_attempt_at) < intervalMs) {
    return { action: 'fail', error: throttleError(account, state, intervalMs) };
  }
  const row = getCredential(accountId);
  return { action: 'attempt', credential: loadPasswordCredential(accountId), credentialUpdatedAt: row.updated_at };
}

export function recordReloginAttempt(tx) {
  return write(() => {
    assertLeaseOwner('account', tx.accountId, tx.token);
    merchantAccount(tx.accountId);
    updateState(tx.accountId, { lastAttemptAt: new Date().toISOString() });
  });
}

function outcomeTransition(outcome) {
  const event = typeof outcome === 'string' ? { outcome } : outcome;
  const transition = event && Object.hasOwn(OUTCOMES, event.outcome) ? OUTCOMES[event.outcome] : null;
  if (!transition) throw new PddCliError({ code: 'E_USAGE', message: '重登结果类别无效', exitCode: ExitCodes.USAGE });
  const reason = transition.reason ?? (CHALLENGES.has(event.challenge) ? event.challenge : 'unknown');
  return { ...transition, reason };
}

function outcomeError(account, transition) {
  const detail = { account: account.slug, reason: transition.reason };
  if (transition.status === 'awaiting_human') return authHumanRequired({ account: account.slug, challenge: transition.reason });
  if (transition.status === 'blocked') return reloginBlocked(detail);
  if (transition.reason === 'form_changed') return passwordLoginFormChanged(detail);
  return transition.reason === 'success' ? null : reloginFailed(detail);
}

export function recordReloginOutcome(tx, outcome, { credentialUpdatedAt }) {
  return write(() => {
    assertLeaseOwner('account', tx.accountId, tx.token);
    const account = merchantAccount(tx.accountId);
    const transition = outcomeTransition(outcome);
    const credential = getCredential(tx.accountId);
    const stale = !credential || credential.updated_at !== credentialUpdatedAt;
    if (stale && transition.status !== 'available') {
      getLogger().warn({ code: 'password_relogin_stale_outcome' }, '凭据已更新，跳过旧重登结果的状态变更');
      return outcomeError(account, transition);
    }
    updateState(tx.accountId, { status: transition.status, reason: transition.reason,
      ...(transition.reason === 'success' ? { consecutiveTakeoverTimeouts: 0 } : {}) });
    if (transition.kind) ensureOpenPendingAction(tx.accountId, { kind: transition.kind, reason: transition.reason });
    return outcomeError(account, transition);
  });
}

export function markManualLoginSucceeded(accountId) {
  return write(() => {
    const state = getReloginState(accountId);
    if (state?.consecutive_takeover_timeouts) updateState(accountId, { consecutiveTakeoverTimeouts: 0 });
    if (state?.status !== 'awaiting_human') return;
    updateState(accountId, { status: 'available', reason: 'manual_login' });
    resolveOpenPendingActions(accountId, 'human_takeover');
  });
}

export function setAccountPassword(accountId, credential) {
  merchantAccount(accountId);
  // 密钥初始化独立完成，避免业务事务回滚后留下已缓存但未落库的密钥指纹。
  getMasterKey();
  return write(() => {
    savePasswordCredential(accountId, credential);
    updateState(accountId, { status: 'available', reason: 'password_reset', lastAttemptAt: null, consecutiveTakeoverTimeouts: 0 });
    resolveOpenPendingActions(accountId);
  });
}

export function clearAccountPassword(accountId) {
  return write(() => {
    deletePasswordCredential(accountId);
    updateState(accountId, { status: 'available', reason: 'password_cleared' });
    resolveOpenPendingActions(accountId);
  });
}

export function clearReloginBlock(accountId) {
  return write(() => {
    merchantAccount(accountId);
    if (getReloginState(accountId)?.status !== 'blocked') return;
    updateState(accountId, { status: 'available', reason: 'manual_unblock', lastAttemptAt: null, consecutiveTakeoverTimeouts: 0 });
    resolveOpenPendingActions(accountId, 'relogin_blocked');
  });
}

export function recordTakeoverTimeout(accountId) {
  return write(() => {
    merchantAccount(accountId);
    const state = getReloginState(accountId);
    const count = (state?.consecutive_takeover_timeouts ?? 0) + 1;
    const shouldBlock = count >= 2 && state?.status !== 'blocked';
    updateState(accountId, { consecutiveTakeoverTimeouts: count,
      ...(shouldBlock ? { status: 'blocked', reason: 'takeover_timeout' } : {}) });
    if (shouldBlock) ensureOpenPendingAction(accountId, { kind: 'relogin_blocked', reason: 'takeover_timeout' });
  });
}

export function getReloginSummary(accountId) {
  const hasPassword = hasPasswordCredential(accountId);
  const state = getReloginState(accountId);
  return { has_password: hasPassword, status: state?.status ?? 'available',
    reason: state?.reason ?? null, last_attempt_at: state?.last_attempt_at ?? null };
}

export function getAccountActionWarnings(accountId, slug) {
  return listPendingActions(accountId).filter((action) => action.status === 'open')
    .map((action) => ({ code: 'account_action_required', account: slug, reason: action.reason }));
}

function hasFixtureRelogin(state) {
  return state?.cookies?.some((cookie) => cookie.name === 'PDD_FIXTURE_RELOGIN' && cookie.value === '1') ?? false;
}

export function fixtureSessionRecovered(accountId) {
  return hasFixtureRelogin(loadAuthState(accountId).state);
}

async function withReloginBudget(runtime, tx, operation) {
  runtime.deadline.pause();
  const controller = new AbortController();
  const task = {
    signal: runtime.signal ? AbortSignal.any([runtime.signal, controller.signal]) : controller.signal,
    deadlineAt: Date.now() + TIMEOUTS.LOGIN_PASSWORD,
  };
  const timer = setTimeout(() => controller.abort(new PddCliError({ code: 'E_AUTH_TIMEOUT', exitCode: ExitCodes.NETWORK })), TIMEOUTS.LOGIN_PASSWORD);
  const previousSignal = tx.signal;
  tx.signal = task.signal;
  tx.deadlineAt = task.deadlineAt;
  try {
    recordReloginAttempt(tx);
    return await operation(task);
  }
  finally {
    clearTimeout(timer);
    runtime.deadline.resume();
    tx.signal = previousSignal;
    tx.deadlineAt = runtime.deadlineAt;
  }
}

function beginRelogin(tx, runtime, authResult) {
  assertAuthTask(tx);
  const decision = decideRelogin(tx.accountId, { minIntervalMs: runtime.runtimeConfig?.passwordReloginMinIntervalMs, authResult });
  if (decision.action === 'fail') throw decision.error;
  return decision;
}

async function runRelogin(tx, decision, task, attempt) {
  assertAuthTask(task);
  let result;
  try { result = await attempt(decision.credential); }
  catch (error) {
    assertAuthTask(task);
    if (error instanceof PddCliError) throw error;
    result = { outcome: 'network_error' };
  }
  assertAuthTask(task);
  const error = recordReloginOutcome(tx, result, decision);
  if (result.verification?.reason === 'identity_mismatch') assertMerchantVerified(result.verification);
  if (error) throw error;
  renewLease('account', tx.accountId, tx.token);
}

export function deviceState(tx) {
  if (tx.corrupt || !Array.isArray(tx.state?.cookies) || !Array.isArray(tx.state?.origins)) return { cookies: [], origins: [] };
  return structuredClone({ cookies: tx.state.cookies.filter((cookie) => cookie.name !== 'PASS_ID'), origins: tx.state.origins });
}

export async function reloginInCommand(runtime, tx, browser, authResult) {
  const decision = beginRelogin(tx, runtime, authResult);
  return withReloginBudget(runtime, tx, async (task) => {
    let context;
    let retained = false;
    const onAbort = () => { void context?.close().catch(() => {}); };
    task.signal.addEventListener('abort', onAbort, { once: true });
    try {
      await runRelogin(tx, decision, task, async (credential) => {
        context = await createSnapshotContext(browser, deviceState(tx));
        assertAuthTask(task);
        const loginPage = await context.newPage();
        const loginTask = { ...task, deadlineAt: task.deadlineAt - TIMEOUTS.LOGIN_PASSWORD_RESERVE };
        const result = await attemptPasswordLogin(loginPage, credential, loginTask);
        assertAuthTask(task);
        if (result.outcome !== 'success') return result;
        await loginPage.close();
        const verified = await verifyMerchantContext(context, { ...task, expectedMallId: tx.recoveryMallId });
        if (verified.verdict !== 'verified') return { outcome: 'verify_failed', verification: verified };
        commitMerchantCandidate(verified.candidate, tx);
        return result;
      });
      const page = await context.newPage();
      assertAuthTask(task);
      retained = true;
      return { context, page };
    } finally {
      task.signal.removeEventListener('abort', onAbort);
      if (!retained && context) { try { await context.close(); } catch { /* 保留原重登错误。 */ } }
    }
  });
}

export function commitFixtureRelogin(tx, task) {
  const checkedAt = new Date().toISOString();
  const state = { cookies: [{ name: 'PDD_FIXTURE_RELOGIN', value: '1', domain: '.pinduoduo.com', path: '/' }], origins: [],
    merchant_auth: { version: 1, mall_id: tx.recoveryMallId, usable: true, scope: 'shop_read',
      check_verdict: 'verified', checked_at: checkedAt,
      last_check: { verdict: 'verified', reason: 'shop_read', checked_at: checkedAt } } };
  write(() => {
    assertAuthTask(task);
    assertLeaseOwner('account', tx.accountId, tx.token);
    tx.revision = saveAuthStateSnapshot(state, tx.accountId, { expectedRevision: tx.revision });
  });
  tx.state = state;
}

export async function reloginForFixture(accountId, runtime) {
  return withMerchantAuthUpdate(accountId, async (tx) => {
    if (hasFixtureRelogin(tx.state)) return;
    const decision = beginRelogin(tx, runtime);
    return withReloginBudget(runtime, tx, (task) => runRelogin(tx, decision, task, async () => {
      const result = await mockPasswordLogin(task);
      if (result.outcome === 'success') commitFixtureRelogin(tx, task);
      return result;
    }));
  }, { signal: runtime.signal, deadlineAt: runtime.deadlineAt });
}
