import { createHash, randomBytes } from 'node:crypto';
import { get, run, transaction } from '../infra/db.js';
import { getAccountById } from '../infra/account-store.js';
import { getDaemonMeta, readDaemonLease } from '../infra/daemon-state.js';
import { PddCliError, ExitCodes, daemonNotRunning } from '../infra/errors.js';
import { toConsoleLinkView } from './views/console.js';

function hash(consoleToken) {
  return createHash('sha256').update(consoleToken).digest('hex');
}

function storageOperation(callback) {
  try { return callback(); }
  catch (error) {
    if (error instanceof PddCliError) throw error;
    throw new PddCliError({ code: 'E_AUTH_STATE_IO', message: '控制台鉴权存储暂不可用', exitCode: ExitCodes.AUTH });
  }
}

function linkFailure(expired = false) {
  return new PddCliError({ code: expired ? 'E_CONSOLE_LINK_EXPIRED' : 'E_CONSOLE_LINK_GONE',
    message: '链接已失效，请重新获取', exitCode: ExitCodes.AUTH });
}

function validSecret(consoleToken) {
  return typeof consoleToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(consoleToken);
}

export function createConsoleLink({ accountId = null } = {}) {
  const base = getDaemonMeta('daemon_console_url');
  if (!readDaemonLease()?.running || !base) throw daemonNotRunning();
  const consoleToken = randomBytes(32).toString('base64url');
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + 600_000).toISOString();
  storageOperation(() => run(`INSERT INTO console_tokens(token_hash, account_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)`, hash(consoleToken), accountId, createdAt, expiresAt));
  return { url: `${base.replace(/\/$/, '')}/c/${consoleToken}`, expires_at: expiresAt };
}

export function redeemConsoleToken(consoleToken) {
  if (!validSecret(consoleToken)) throw linkFailure();
  return storageOperation(() => transaction(() => {
    const now = Date.now();
    const row = get('SELECT * FROM console_tokens WHERE token_hash = ?', hash(consoleToken));
    if (!row || row.consumed_at) throw linkFailure();
    if (!(Date.parse(row.expires_at) > now)) throw linkFailure(true);
    const consoleSession = randomBytes(32).toString('base64url');
    const createdAt = new Date(now).toISOString();
    run('UPDATE console_tokens SET consumed_at = ? WHERE token_hash = ?', createdAt, row.token_hash);
    run('INSERT INTO console_sessions VALUES (?, ?, ?, ?)', hash(consoleSession), row.account_id,
      createdAt, new Date(now + 28_800_000).toISOString());
    return { sessionValue: consoleSession, accountSlug: getAccountById(row.account_id)?.slug ?? null };
  }));
}

export function resolveConsoleSession(consoleSession) {
  if (!validSecret(consoleSession)) return null;
  return storageOperation(() => {
    const row = get('SELECT account_id, created_at, expires_at FROM console_sessions WHERE session_hash = ?', hash(consoleSession));
    return row && Date.parse(row.expires_at) > Date.now() ? { ...row } : null;
  });
}

export function consoleSessionCookie(consoleSession, runtimeConfig) {
  const secure = runtimeConfig?.consolePublicUrl && new URL(runtimeConfig.consolePublicUrl).protocol === 'https:' ? '; Secure' : '';
  return `pdd_console=${consoleSession}; HttpOnly; SameSite=Strict; Path=/${secure}`;
}

export function getConsoleLinkView({ accountId = null } = {}) {
  return toConsoleLinkView(createConsoleLink({ accountId }));
}
