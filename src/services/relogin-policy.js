import { hasPasswordCredential, loadPasswordCredential, savePasswordCredential, deletePasswordCredential } from '../adapter/password-credential.js';
import { loadAuthState } from '../adapter/auth-state.js';
import { assertAuthTask, assertMerchantVerified } from '../infra/auth-task.js';
import { getAccountById, getCredential, getReloginState, putReloginState,
  ensureOpenPendingAction, resolveOpenPendingActions, listPendingActions } from '../infra/account-store.js';
import { transaction, isInTransaction } from '../infra/db.js';
import { assertLeaseOwner } from '../infra/leases.js';
import { getLogger } from '../infra/logger.js';
import { getMasterKey } from '../infra/master-key.js';
import { isoToLocalDateTime } from '../infra/units.js';
import { PddCliError, ExitCodes, authHumanRequired, reloginBlocked, reloginFailed, passwordLoginFormChanged } from '../infra/errors.js';

const DEFAULT_PASSWORD_RELOGIN_MIN_INTERVAL_MS = 1_800_000;
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
  try {
    return isInTransaction() ? callback() : transaction(callback);
  } catch (error) {
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
    status: previous?.status ?? 'available',
    reason: previous?.reason ?? null,
    consecutiveTakeoverTimeouts: previous?.consecutive_takeover_timeouts ?? 0,
    lastAttemptAt: previous?.last_attempt_at ?? null,
    ...changes,
  });
}

function authExpired(detail, authResult = { verdict: 'rejected', reason: 'auth_missing' }) {
  try {
    assertMerchantVerified(authResult, { detail });
  } catch (error) {
    return error;
  }
}

function throttleError(account, state, minIntervalMs) {
  const nextAttemptAt = isoToLocalDateTime(new Date(Date.parse(state.last_attempt_at) + minIntervalMs).toISOString());
  const detail = { account: account.slug, reason: state.reason, relogin: 'throttled', next_attempt_at: nextAttemptAt };
  if (state.reason === 'success') return authExpired(detail);
  if (state.reason === 'form_changed') return passwordLoginFormChanged(detail);
  return reloginFailed(detail);
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

function recordReloginAttempt(tx) {
  const nowIso = new Date(tx?.clock?.now ? tx.clock.now() : Date.now()).toISOString();
  return write(() => {
    assertLeaseOwner('account', tx.accountId, tx.token);
    merchantAccount(tx.accountId);
    updateState(tx.accountId, { lastAttemptAt: nowIso });
  });
}

function recordReloginOutcome(tx, outcome, { credentialUpdatedAt }) {
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
    updateState(tx.accountId, {
      status: transition.status,
      reason: transition.reason,
      ...(transition.reason === 'success' ? { consecutiveTakeoverTimeouts: 0 } : {}),
    });
    if (transition.kind) ensureOpenPendingAction(tx.accountId, { kind: transition.kind, reason: transition.reason });
    return outcomeError(account, transition);
  });
}

function assertSealedCandidate(candidate, seal) {
  if (!seal || typeof seal.assert !== 'function') {
    throw new PddCliError({
      code: 'E_AUTH_CANDIDATE_INVALID',
      message: '只有本次校验通过的冻结材料可以提交',
      exitCode: ExitCodes.AUTH,
    });
  }
  seal.assert(candidate);
}

/** Decide whether a relogin attempt should proceed, decrypting credentials only when allowed. */
export function decideRelogin(accountId, {
  now = Date.now(),
  minIntervalMs,
  passwordReloginMinIntervalMs,
  authResult,
  manual = false,
  decrypt = true,
} = {}) {
  const state = getReloginState(accountId);
  if (manual && state?.status === 'blocked') {
    return { action: 'fail', error: reloginBlocked({ account: merchantAccount(accountId).slug, reason: state.reason }) };
  }
  if (!hasPasswordCredential(accountId)) return { action: 'fail', error: authExpired(undefined, authResult) };
  const account = merchantAccount(accountId);
  if (state?.status === 'blocked') return { action: 'fail', error: reloginBlocked({ account: account.slug, reason: state.reason }) };
  if (!manual && state?.status === 'awaiting_human') {
    return { action: 'fail', error: authHumanRequired({ account: account.slug, challenge: state.reason }) };
  }
  const configuredInterval = minIntervalMs ?? passwordReloginMinIntervalMs;
  const intervalMs = Number.isFinite(configuredInterval) && configuredInterval > 0
    ? configuredInterval
    : DEFAULT_PASSWORD_RELOGIN_MIN_INTERVAL_MS;
  if (!manual && state?.last_attempt_at && now - Date.parse(state.last_attempt_at) < intervalMs) {
    return { action: 'fail', error: throttleError(account, state, intervalMs) };
  }
  const row = getCredential(accountId);
  return {
    action: 'attempt',
    credential: decrypt ? loadPasswordCredential(accountId) : undefined,
    credentialUpdatedAt: row.updated_at,
  };
}

/** Start a relogin attempt under an account lease and return atomic fail/succeed handlers. */
export function beginReloginAttempt(tx, {
  manual = false,
  password = true,
  credentialUpdatedAt,
  commit,
  seal,
} = {}) {
  assertAuthTask(tx);
  if (password) recordReloginAttempt(tx);
  const activeSeal = seal === undefined ? tx?.seal : seal;
  return {
    fail(outcome) {
      if ((typeof outcome === 'string' ? outcome : outcome?.outcome) === 'success') {
        throw new PddCliError({ code: 'E_USAGE', message: '重登成功须提交已验证材料', exitCode: ExitCodes.USAGE });
      }
      const error = recordReloginOutcome(tx, outcome, { credentialUpdatedAt });
      if (error) throw error;
    },
    succeed(candidate) {
      assertSealedCandidate(candidate, activeSeal);
      if (typeof commit !== 'function') {
        throw new PddCliError({
          code: 'E_CONFIG_INVALID',
          message: 'beginReloginAttempt 需要有效的 commit 回调',
          exitCode: ExitCodes.GENERAL,
        });
      }
      getMasterKey();
      const draft = { ...tx, seal: activeSeal };
      const saved = write(() => {
        assertAuthTask(tx);
        assertLeaseOwner('account', tx.accountId, tx.token);
        commit(candidate, draft);
        if (manual) markManualLoginSucceeded(tx.accountId);
        if (password) recordReloginOutcome(tx, 'success', { credentialUpdatedAt });
        return loadAuthState(tx.accountId);
      });
      Object.assign(tx, saved);
    },
  };
}

/** Resolve awaiting_human status and reset takeover timeout counter after manual login succeeds. */
export function markManualLoginSucceeded(accountId) {
  return write(() => {
    const state = getReloginState(accountId);
    if (state?.consecutive_takeover_timeouts) updateState(accountId, { consecutiveTakeoverTimeouts: 0 });
    if (state?.status !== 'awaiting_human') return;
    updateState(accountId, { status: 'available', reason: 'manual_login' });
    resolveOpenPendingActions(accountId, 'human_takeover');
  });
}

/** Save encrypted login credentials and reset relogin state and open pending actions. */
export function setAccountPassword(accountId, credential) {
  merchantAccount(accountId);
  // 密钥初始化独立完成，避免业务事务回滚后留下已缓存但未落库的密钥指纹。
  getMasterKey();
  return write(() => {
    savePasswordCredential(accountId, credential);
    updateState(accountId, {
      status: 'available',
      reason: 'password_reset',
      lastAttemptAt: null,
      consecutiveTakeoverTimeouts: 0,
    });
    resolveOpenPendingActions(accountId);
  });
}

/** Delete stored login credentials and restore available relogin state. */
export function clearAccountPassword(accountId) {
  return write(() => {
    deletePasswordCredential(accountId);
    updateState(accountId, { status: 'available', reason: 'password_cleared' });
    resolveOpenPendingActions(accountId);
  });
}

/** Clear a blocked relogin state and resolve relogin_blocked pending actions. */
export function clearReloginBlock(accountId) {
  return write(() => {
    merchantAccount(accountId);
    if (getReloginState(accountId)?.status !== 'blocked') return;
    updateState(accountId, {
      status: 'available',
      reason: 'manual_unblock',
      lastAttemptAt: null,
      consecutiveTakeoverTimeouts: 0,
    });
    resolveOpenPendingActions(accountId, 'relogin_blocked');
  });
}

/** Increment consecutive takeover timeouts and block the account on the second timeout. */
export function recordTakeoverTimeout(accountId) {
  return write(() => {
    merchantAccount(accountId);
    const state = getReloginState(accountId);
    const count = (state?.consecutive_takeover_timeouts ?? 0) + 1;
    const shouldBlock = count >= 2 && state?.status !== 'blocked';
    updateState(accountId, {
      consecutiveTakeoverTimeouts: count,
      ...(shouldBlock ? { status: 'blocked', reason: 'takeover_timeout' } : {}),
    });
    if (shouldBlock) ensureOpenPendingAction(accountId, { kind: 'relogin_blocked', reason: 'takeover_timeout' });
  });
}

/** Read account relogin summary without decrypting credentials or requiring a matching master key. */
export function getReloginSummary(accountId) {
  const hasPassword = hasPasswordCredential(accountId);
  const state = getReloginState(accountId);
  return {
    has_password: hasPassword,
    status: state?.status ?? 'available',
    reason: state?.reason ?? null,
    last_attempt_at: state?.last_attempt_at ?? null,
  };
}

/** List open pending actions formatted as command warning entries. */
export function getAccountActionWarnings(accountId, slug) {
  return listPendingActions(accountId)
    .filter((action) => action.status === 'open')
    .map((action) => ({ code: 'account_action_required', account: slug, reason: action.reason }));
}

/** Clone stored device continuity snapshot with all PASS_ID cookies stripped. */
export function extractDeviceState(tx) {
  if (tx?.corrupt || !Array.isArray(tx?.state?.cookies) || !Array.isArray(tx?.state?.origins)) {
    return { cookies: [], origins: [] };
  }
  return structuredClone({
    cookies: tx.state.cookies.filter((cookie) => cookie.name !== 'PASS_ID'),
    origins: tx.state.origins,
  });
}
