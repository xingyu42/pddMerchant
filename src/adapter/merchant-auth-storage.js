import { acquireLease, releaseLease, assertLeaseOwner } from '../infra/leases.js';
import { transaction as databaseTransaction } from '../infra/db.js';
import { getAccountById, getReloginState } from '../infra/account-store.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { getMasterKey } from '../infra/master-key.js';
import { loadAuthState, authStateConflict, saveAuthStateSnapshot } from './auth-state.js';
import { assertVerifiedMerchantCandidate, verifyMerchantContext } from './merchant-auth.js';
import { budgetMs } from '../infra/abort.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';

export function assertAuthTask({ signal, deadlineAt } = {}) {
  const expired = (deadlineAt != null && Date.now() >= deadlineAt)
    || (signal?.aborted && signal.reason instanceof PddCliError && signal.reason.code === 'E_AUTH_TIMEOUT');
  if (signal?.aborted || expired) {
    throw new PddCliError({ code: expired ? 'E_AUTH_TIMEOUT' : 'E_AUTH_CANCELLED', message: expired ? '认证任务超过截止时间' : '认证任务已取消', exitCode: ExitCodes.NETWORK });
  }
}

export function boundMerchantMallId(state) {
  const metadata = state?.merchant_auth;
  if (!metadata) return null;
  if (metadata.version !== 1 || (metadata.mall_id != null && !/^[1-9][0-9]{0,14}$/.test(String(metadata.mall_id)))) {
    throw new PddCliError({ code: 'E_AUTH_STATE_CORRUPT', message: '商家登录态绑定元数据格式无效', exitCode: ExitCodes.AUTH });
  }
  return metadata.mall_id == null ? null : String(metadata.mall_id);
}

// 已记录 rejected 的凭据直接短路；否则按显式店铺或凭据绑定店铺做协议校验。
export async function verifyStoredMerchant(context, state, task = {}) {
  if (state?.merchant_auth?.last_check?.verdict === 'rejected') {
    return { verdict: 'rejected', reason: 'known_rejected', checked_at: new Date().toISOString() };
  }
  const boundMallId = boundMerchantMallId(state);
  if (boundMallId && task.expectedMallId != null && String(task.expectedMallId) !== boundMallId) {
    return { verdict: 'failed', reason: 'identity_mismatch', checked_at: new Date().toISOString() };
  }
  return verifyMerchantContext(context, { ...task, expectedMallId: task.expectedMallId ?? boundMallId });
}

async function updateMerchantAuth(accountId, fn, options = {}) {
  assertAuthTask(options);
  const timeoutMs = options.timeoutMs === 0 ? 0 : budgetMs(options, 15000);
  const ttlMs = Math.max(0, (options.deadlineAt ?? Date.now() + timeoutMs) - Date.now()) + 30000;
  const extendUntil = () => {
    const startedAt = Date.parse(getReloginState(accountId)?.last_attempt_at);
    return Date.now() < startedAt + TIMEOUTS.LOGIN_PASSWORD ? startedAt + TIMEOUTS.LOGIN_PASSWORD + 15000 : null;
  };
  const lock = await acquireLease('account', accountId, {
    timeoutMs, ttlMs, signal: options.signal, deadlineAt: options.deadlineAt, extendUntil,
  });
  try {
    assertAuthTask(options);
    const account = getAccountById(accountId);
    if (account?.kind !== 'merchant') throw authStateConflict();
    if (options.recoveryMallId != null && String(options.recoveryMallId) !== account.identity) {
      throw new PddCliError({ code: 'E_ACCOUNT_IDENTITY_MISMATCH', message: '恢复店铺与账号绑定不一致', exitCode: ExitCodes.AUTH });
    }
    const loaded = loadAuthState(accountId, { allowCorrupt: options.recoveryMallId != null });
    assertAuthTask(options);
    const transaction = { ...options, ...loaded, accountId, token: lock.token, recoveryMallId: account.identity };
    return await fn(transaction);
  } finally {
    try { releaseLease('account', accountId, lock.token); }
    catch {
      try { getLogger().warn({ code: 'auth_lease_release_failed' }, '认证租约释放失败'); }
      catch { /* 清理与日志失败均保留原结果。 */ }
    }
  }
}

export async function withMerchantAuthUpdate(accountId, fn, options = {}) {
  try { return await updateMerchantAuth(accountId, fn, options); }
  catch (error) {
    if (error instanceof PddCliError) throw error;
    const filesystem = ['EACCES', 'EPERM', 'ENOSPC', 'EIO', 'EMFILE'].includes(error?.code);
    throw new PddCliError({ code: filesystem ? 'E_AUTH_STATE_IO' : 'E_AUTH_UPDATE_FAILED', message: filesystem ? '无法访问或更新登录态' : '认证任务未完成', exitCode: filesystem ? ExitCodes.AUTH : ExitCodes.GENERAL });
  }
}

function assertCurrent(transaction) {
  assertAuthTask(transaction);
  assertLeaseOwner('account', transaction.accountId, transaction.token);
}

export function merchantCandidateState(candidate, transaction = {}) {
  assertVerifiedMerchantCandidate(candidate);
  if (transaction.recoveryMallId != null && String(transaction.recoveryMallId) !== candidate.identity.mallId) {
    throw new PddCliError({ code: 'E_ACCOUNT_IDENTITY_MISMATCH', message: '候选店铺与登记店铺不一致', exitCode: ExitCodes.AUTH });
  }
  const bound = boundMerchantMallId(transaction.state);
  if (bound && bound !== candidate.identity.mallId) {
    throw new PddCliError({ code: 'E_ACCOUNT_IDENTITY_MISMATCH', message: '候选店铺与凭据文件绑定不一致', exitCode: ExitCodes.AUTH });
  }
  return {
    cookies: candidate.state.cookies, origins: candidate.state.origins,
    merchant_auth: {
      version: 1, mall_id: candidate.identity.mallId, checked_at: candidate.checked_at,
      scope: candidate.scope, check_verdict: 'verified', usable: true,
      last_check: { verdict: 'verified', reason: 'shop_read', checked_at: candidate.checked_at },
    },
  };
}

function commitState(state, transaction) {
  assertAuthTask(transaction);
  getMasterKey();
  const revision = databaseTransaction(() => {
    assertCurrent(transaction);
    return saveAuthStateSnapshot(state, transaction.accountId, { expectedRevision: transaction.revision });
  });
  transaction.revision = revision;
  transaction.state = state;
  transaction.metadata = state.merchant_auth ?? null;
  transaction.corrupt = false;
  return transaction.accountId;
}

export function commitMerchantCandidate(candidate, transaction, { expectedRevision = transaction.revision } = {}) {
  const state = merchantCandidateState(candidate, transaction);
  if (transaction.revision !== expectedRevision) throw authStateConflict();
  return commitState(state, transaction);
}

export function recordMerchantCheck(result, transaction) {
  if (!transaction.state || !['rejected', 'indeterminate'].includes(result.verdict)) return;
  const metadata = transaction.state.merchant_auth ?? { version: 1, mall_id: null };
  const state = { ...transaction.state, merchant_auth: {
    ...metadata, usable: false,
    last_check: { verdict: result.verdict, reason: result.reason, checked_at: result.checked_at },
  } };
  return commitState(state, transaction);
}
