import { hasPasswordCredential, loadPasswordCredential, savePasswordCredential, deletePasswordCredential } from '../adapter/password-credential.js';
import { assertMerchantVerified } from '../adapter/merchant-auth.js';
import { getAccountById, getCredential, getReloginState, putReloginState,
  ensureOpenPendingAction, resolveOpenPendingActions } from '../infra/account-store.js';
import { transaction, isInTransaction } from '../infra/db.js';
import { assertLeaseOwner } from '../infra/leases.js';
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

function authExpired(detail) {
  try { assertMerchantVerified({ verdict: 'rejected', reason: 'auth_missing' }, { detail }); }
  catch (error) { return error; }
}

function throttleError(account, state, minIntervalMs) {
  const detail = { account: account.slug, reason: state.reason,
    relogin: 'throttled', next_attempt_at: isoToLocalDateTime(new Date(Date.parse(state.last_attempt_at) + minIntervalMs).toISOString()) };
  if (state.reason === 'success') return authExpired(detail);
  if (state.reason === 'form_changed') return passwordLoginFormChanged(detail);
  return reloginFailed(detail);
}

export function decideRelogin(accountId, { now = Date.now(), minIntervalMs }) {
  if (!hasPasswordCredential(accountId)) return { action: 'fail', error: authExpired() };
  const account = merchantAccount(accountId);
  const state = getReloginState(accountId);
  if (state?.status === 'blocked') return { action: 'fail', error: reloginBlocked({ account: account.slug, reason: state.reason }) };
  if (state?.status === 'awaiting_human') return { action: 'fail', error: authHumanRequired({ account: account.slug, challenge: state.reason }) };
  if (state?.last_attempt_at && now - Date.parse(state.last_attempt_at) < minIntervalMs) {
    return { action: 'fail', error: throttleError(account, state, minIntervalMs) };
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
    if (getReloginState(accountId)?.status !== 'awaiting_human') return;
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
