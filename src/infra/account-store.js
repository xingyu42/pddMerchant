import { all as databaseAll, get as databaseGet, run, transaction, isInTransaction } from './db.js';
import { slugifyStorageName } from './path-slug.js';
import { accountNotFound, accountAmbiguous, PddCliError, ExitCodes } from './errors.js';

function storageOperation(callback) {
  try { return callback(); }
  catch (error) {
    if (error instanceof PddCliError) throw error;
    throw new PddCliError({ code: 'E_AUTH_ACCOUNT_SAVE_FAILED', message: '账号存储暂不可用', exitCode: ExitCodes.AUTH });
  }
}

function all(...args) {
  return storageOperation(() => databaseAll(...args));
}

function get(...args) {
  return storageOperation(() => databaseGet(...args));
}

function write(callback) {
  return storageOperation(() => isInTransaction() ? callback() : transaction(callback));
}

export function listAccounts({ kind = 'merchant', includeDisabled = false } = {}) {
  return all(`SELECT * FROM accounts WHERE kind = ? ${includeDisabled ? '' : 'AND disabled = 0'} ORDER BY id`, kind);
}

export function getAccount(slug, { kind = 'merchant', allowDisplayName = false } = {}) {
  const found = get('SELECT * FROM accounts WHERE kind = ? AND slug = ?', kind, slug);
  if (found || !allowDisplayName) return found ?? null;
  const matches = all('SELECT * FROM accounts WHERE kind = ? AND display_name = ?', kind, slug);
  if (matches.length > 1 && kind === 'merchant') throw accountAmbiguous(slug, matches.map((account) => account.slug));
  return matches.length === 1 ? matches[0] : null;
}

export function getAccountById(accountId) {
  return get('SELECT * FROM accounts WHERE id = ?', accountId) ?? null;
}

export function findAccountByIdentity(kind, identity) {
  return get('SELECT * FROM accounts WHERE kind = ? AND identity = ?', kind, String(identity)) ?? null;
}

export function insertAccount({ kind = 'merchant', identity, displayName, lastLoginAt = null, lastUsedAt = null }, { setDefault = false } = {}) {
  return write(() => {
    const accounts = listAccounts({ kind, includeDisabled: true });
    const slug = slugifyStorageName(displayName, { existingSlugs: new Set(accounts.map((account) => account.slug)), stableId: identity });
    const now = new Date().toISOString();
    // 删除后重新登录也不会复用旧候选的账号 ID 和 AAD。
    const sequence = Number(get("SELECT value FROM meta WHERE key = 'account_sequence'")?.value ?? 0);
    const accountId = Math.max(sequence, get('SELECT COALESCE(MAX(id), 0) AS value FROM accounts').value) + 1;
    run("INSERT INTO meta(key, value) VALUES ('account_sequence', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(accountId));
    run(`INSERT INTO accounts(id, kind, slug, display_name, identity, created_at, updated_at, last_login_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, accountId, kind, slug, displayName, String(identity), now, now, lastLoginAt, lastUsedAt);
    if (setDefault) setDefaultAccount(slug, { kind });
    return getAccountById(accountId);
  });
}

export function updateAccount(accountId, { displayName, lastLoginAt, lastUsedAt, disabled } = {}) {
  return write(() => {
    const existing = getAccountById(accountId);
    if (!existing) throw accountNotFound(String(accountId));
    run('UPDATE accounts SET display_name = ?, last_login_at = ?, last_used_at = ?, disabled = ?, updated_at = ? WHERE id = ?',
      displayName ?? existing.display_name, lastLoginAt ?? existing.last_login_at, lastUsedAt ?? existing.last_used_at,
      disabled == null ? existing.disabled : Number(disabled), new Date().toISOString(), accountId);
    return getAccountById(accountId);
  });
}

export function setDefaultAccount(slug, { kind = 'merchant' } = {}) {
  return write(() => {
    const account = getAccount(slug, { kind });
    if (!account) throw accountNotFound(slug);
    run('UPDATE accounts SET is_default = 0 WHERE kind = ?', kind);
    run('UPDATE accounts SET is_default = 1, updated_at = ? WHERE id = ?', new Date().toISOString(), account.id);
    return getAccountById(account.id);
  });
}

export function removeAccount(slug, { kind = 'merchant' } = {}) {
  return write(() => {
    const account = getAccount(slug, { kind });
    if (!account) throw accountNotFound(slug);
    run('DELETE FROM accounts WHERE id = ?', account.id);
    return account;
  });
}

export function getCredential(accountId) {
  return get('SELECT * FROM credentials WHERE account_id = ?', accountId) ?? null;
}

export function putCredential(accountId, passwordSealed) {
  return write(() => run(`INSERT INTO credentials(account_id, password_sealed, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET password_sealed = excluded.password_sealed, updated_at = excluded.updated_at`,
  accountId, passwordSealed, new Date().toISOString()));
}

export function getReloginState(accountId) {
  return get('SELECT * FROM relogin_states WHERE account_id = ?', accountId) ?? null;
}

export function putReloginState(accountId, { status, reason = null, consecutiveTakeoverTimeouts = 0, lastAttemptAt = null }) {
  return write(() => run(`INSERT INTO relogin_states(account_id, status, reason, consecutive_takeover_timeouts, last_attempt_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET status = excluded.status, reason = excluded.reason,
    consecutive_takeover_timeouts = excluded.consecutive_takeover_timeouts, last_attempt_at = excluded.last_attempt_at,
    updated_at = excluded.updated_at`, accountId, status, reason, consecutiveTakeoverTimeouts, lastAttemptAt, new Date().toISOString()));
}

export function listPendingActions(accountId) {
  return all('SELECT * FROM pending_actions WHERE account_id = ? ORDER BY id', accountId);
}

export function insertPendingAction(accountId, { kind, reason }) {
  return write(() => Number(run(`INSERT INTO pending_actions(account_id, kind, reason, status, created_at)
    VALUES (?, ?, ?, 'open', ?)`, accountId, kind, reason, new Date().toISOString()).lastInsertRowid));
}

export function resolvePendingAction(actionId) {
  return write(() => run("UPDATE pending_actions SET status = 'resolved', resolved_at = ? WHERE id = ? AND status = 'open'",
    new Date().toISOString(), actionId));
}
