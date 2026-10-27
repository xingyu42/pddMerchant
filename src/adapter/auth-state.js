import { get, run, transaction, isInTransaction } from '../infra/db.js';
import { aad, seal, open } from '../infra/secret-box.js';
import { getMasterKey } from '../infra/master-key.js';
import { getLogger } from '../infra/logger.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { isMockEnabled, mockIsConsumerAuthValid } from './mock-dispatcher.js';

export const PDD_HOME = 'https://mms.pinduoduo.com';
export const CONSUMER_HOME = 'https://mobile.yangkeduo.com';

export function validateShape(state) {
  return Boolean(state && typeof state === 'object' && Array.isArray(state.cookies) && Array.isArray(state.origins));
}

export function authStateConflict() {
  return new PddCliError({ code: 'E_AUTH_STATE_CONFLICT', message: '登录态或账号已被其他任务更新，请重新执行登录或命令', exitCode: ExitCodes.AUTH });
}

function metadataOf(row) {
  if (!row.bound_mall_id && !row.check_verdict && !row.last_check_verdict) return null;
  return {
    version: 1, mall_id: row.bound_mall_id, usable: Boolean(row.usable),
    check_verdict: row.check_verdict, scope: row.scope, checked_at: row.checked_at,
    ...(row.last_check_verdict ? { last_check: {
      verdict: row.last_check_verdict, reason: row.last_check_reason, checked_at: row.last_check_at,
    } } : {}),
  };
}

export function getAuthStateMetadata(accountId) {
  try {
    const row = get(`SELECT bound_mall_id, usable, check_verdict, scope, checked_at,
      last_check_verdict, last_check_reason, last_check_at FROM auth_states WHERE account_id = ?`, accountId);
    return row ? metadataOf(row) : null;
  } catch (error) { throw storageError(error); }
}

export function getAuthStateRevision(accountId) {
  try { return get('SELECT revision FROM auth_states WHERE account_id = ?', accountId)?.revision ?? 0; }
  catch (error) { throw storageError(error); }
}

function storageError(error, code = 'E_AUTH_STATE_IO', message = '无法访问登录态') {
  return error instanceof PddCliError ? error : new PddCliError({ code, message, exitCode: ExitCodes.AUTH });
}

export function loadAuthState(accountId, options = {}) {
  try { return readAuthState(accountId, options); }
  catch (error) { throw storageError(error); }
}

function readAuthState(accountId, { allowCorrupt = false } = {}) {
  const row = accountId == null ? null : get('SELECT * FROM auth_states WHERE account_id = ?', accountId);
  if (!row) return { accountId, exists: false, state: null, revision: 0, metadata: null, corrupt: false };
  const snapshot = open(row.state_sealed, aad('auth_states', accountId));
  const corrupt = !validateShape(snapshot);
  if (corrupt && !allowCorrupt) {
    throw new PddCliError({ code: 'E_AUTH_STATE_CORRUPT', message: '登录材料格式无效', hint: '执行 pdd login 重新登录', exitCode: ExitCodes.AUTH });
  }
  const metadata = metadataOf(row);
  const state = { ...snapshot, ...(metadata ? { merchant_auth: metadata } : {}) };
  return { accountId, exists: true, state, revision: row.revision, metadata, corrupt };
}

function persistSnapshot(state, accountId, expectedRevision) {
  const metadata = state.merchant_auth ?? {};
  const lastCheck = metadata.last_check ?? {};
  const sealed = seal({ cookies: state.cookies, origins: state.origins }, aad('auth_states', accountId));
  const values = [sealed, metadata.mall_id ?? null, Number(metadata.usable ?? true), metadata.check_verdict ?? null,
    metadata.scope ?? null, metadata.checked_at ?? null, lastCheck.verdict ?? null, lastCheck.reason ?? null,
    lastCheck.checked_at ?? null, new Date().toISOString()];
  const revision = expectedRevision ?? getAuthStateRevision(accountId);
  if (!get('SELECT id FROM accounts WHERE id = ?', accountId)) throw authStateConflict();
  const result = revision === 0
    ? run(`INSERT INTO auth_states(account_id, revision, state_sealed, bound_mall_id, usable, check_verdict, scope,
      checked_at, last_check_verdict, last_check_reason, last_check_at, updated_at)
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id) DO NOTHING`, accountId, ...values)
    : run(`UPDATE auth_states SET state_sealed = ?, bound_mall_id = ?, usable = ?, check_verdict = ?, scope = ?,
      checked_at = ?, last_check_verdict = ?, last_check_reason = ?, last_check_at = ?, updated_at = ?,
      revision = revision + 1 WHERE account_id = ? AND revision = ?`, ...values, accountId, revision);
  if (result.changes === 0) throw authStateConflict();
  return revision + 1;
}

export function saveAuthStateSnapshot(state, accountId, { expectedRevision } = {}) {
  if (!validateShape(state)) {
    throw new PddCliError({ code: 'E_AUTH_STATE_CORRUPT', message: '冻结登录材料格式无效', exitCode: ExitCodes.AUTH });
  }
  try {
    if (!isInTransaction()) getMasterKey();
    const write = () => persistSnapshot(state, accountId, expectedRevision);
    return isInTransaction() ? write() : transaction(write);
  } catch (error) {
    if (error instanceof PddCliError) throw error;
    throw new PddCliError({ code: 'E_AUTH_STATE_SAVE_FAILED', message: '登录材料未能保存', exitCode: ExitCodes.AUTH });
  }
}

export function deleteAuthState(accountId) {
  const remove = () => ({ removed: true, existed: run('DELETE FROM auth_states WHERE account_id = ?', accountId).changes > 0 });
  try { return isInTransaction() ? remove() : transaction(remove); }
  catch (error) { throw storageError(error, 'E_AUTH_STATE_DELETE_FAILED', '删除登录态失败'); }
}

export async function isConsumerAuthValid(page, { timeoutMs = 15000 } = {}) {
  if (isMockEnabled()) return mockIsConsumerAuthValid();
  try {
    await page.goto(CONSUMER_HOME, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    return !page.url().includes('/login');
  } catch (err) {
    getLogger().debug({ err: err?.message }, 'isConsumerAuthValid navigation failed');
    return false;
  }
}
