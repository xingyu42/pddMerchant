import { mkdir, realpath } from 'node:fs/promises';
import { dirname, resolve, join, basename } from 'node:path';
import { acquireLock, releaseLock, assertLockOwner } from '../infra/auth-lock.js';
import { loadAuthStateWithRevision, getAuthStateRevision, saveAuthStateSnapshot } from './auth-state.js';
import { assertVerifiedMerchantCandidate, verifyMerchantContext } from './merchant-auth.js';
import { budgetMs } from '../infra/abort.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';

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
  return verifyMerchantContext(context, { ...task, expectedMallId: task.expectedMallId ?? boundMerchantMallId(state) });
}

async function canonicalAuthPath(path) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  try { return await realpath(absolute); }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return join(await realpath(dirname(absolute)), basename(absolute));
  }
}

async function updateMerchantAuth(path, fn, options = {}) {
  assertAuthTask(options);
  const canonical = await canonicalAuthPath(path);
  const lock = await acquireLock(canonical, { timeoutMs: budgetMs(options, 15000), signal: options.signal });
  try {
    assertAuthTask(options);
    // 仅有可信登记店铺的重新授权可忽略损坏状态；保留修订号和可解析的绑定。
    const { state, revision, corrupt = false } = await loadAuthStateWithRevision(canonical, { allowCorrupt: options.recoveryMallId != null });
    assertAuthTask(options);
    const transaction = { ...options, path: canonical, token: lock.token, revision, state, corrupt };
    return await fn(transaction);
  } finally { await releaseLock(canonical, lock.token); }
}

export async function withMerchantAuthUpdate(path, fn, options = {}) {
  try { return await updateMerchantAuth(path, fn, options); }
  catch (error) {
    if (error instanceof PddCliError) throw error;
    const filesystem = ['EACCES', 'EPERM', 'ENOSPC', 'EIO', 'EMFILE'].includes(error?.code);
    throw new PddCliError({ code: filesystem ? 'E_AUTH_STATE_IO' : 'E_AUTH_UPDATE_FAILED', message: filesystem ? '无法访问或更新登录态文件' : '认证任务未完成', exitCode: filesystem ? ExitCodes.AUTH : ExitCodes.GENERAL });
  }
}

async function assertCurrent(transaction) {
  assertAuthTask(transaction);
  await assertLockOwner(transaction.path, transaction.token);
  if (await getAuthStateRevision(transaction.path) !== transaction.revision) {
    throw new PddCliError({ code: 'E_AUTH_STATE_CONFLICT', message: '登录态已被其他任务更新，本次结果未保存', exitCode: ExitCodes.AUTH });
  }
  assertAuthTask(transaction);
}

export async function commitMerchantCandidate(candidate, transaction, { expectedRevision = transaction.revision } = {}) {
  assertVerifiedMerchantCandidate(candidate);
  if (transaction.recoveryMallId != null && String(transaction.recoveryMallId) !== candidate.identity.mallId) {
    throw new PddCliError({ code: 'E_ACCOUNT_IDENTITY_MISMATCH', message: '候选店铺与登记店铺不一致', exitCode: ExitCodes.AUTH });
  }
  const bound = boundMerchantMallId(transaction.state);
  if (bound && bound !== candidate.identity.mallId) {
    throw new PddCliError({ code: 'E_ACCOUNT_IDENTITY_MISMATCH', message: '候选店铺与凭据文件绑定不一致', exitCode: ExitCodes.AUTH });
  }
  if (transaction.revision !== expectedRevision) {
    throw new PddCliError({ code: 'E_AUTH_STATE_CONFLICT', message: '任务开始后登录态已更新，本次结果未保存', exitCode: ExitCodes.AUTH });
  }
  const state = {
    cookies: candidate.state.cookies, origins: candidate.state.origins,
    merchant_auth: {
      version: 1, mall_id: candidate.identity.mallId, checked_at: candidate.checked_at,
      scope: candidate.scope, check_verdict: 'verified', usable: true,
      last_check: { verdict: 'verified', reason: 'shop_read', checked_at: candidate.checked_at },
    },
  };
  transaction.revision = await saveAuthStateSnapshot(state, transaction.path, { beforeCommit: () => assertCurrent(transaction) });
  transaction.state = state;
  return transaction.path;
}

export async function recordMerchantCheck(result, transaction) {
  if (!transaction.state || !['rejected', 'indeterminate'].includes(result.verdict)) return;
  const metadata = transaction.state.merchant_auth ?? { version: 1, mall_id: null };
  const state = { ...transaction.state, merchant_auth: {
    ...metadata, usable: false,
    last_check: { verdict: result.verdict, reason: result.reason, checked_at: result.checked_at },
  } };
  transaction.revision = await saveAuthStateSnapshot(state, transaction.path, { beforeCommit: () => assertCurrent(transaction) });
  transaction.state = state;
}
