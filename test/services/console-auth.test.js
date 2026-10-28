import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { beforeEach, it, vi } from 'vitest';
import { createConsoleLink, redeemConsoleToken, resolveConsoleSession, consoleSessionCookie } from '../../src/services/console-auth.js';
import { acquireDaemonLease, setDaemonMeta } from '../../src/infra/daemon-state.js';
import { insertAccount, removeAccount } from '../../src/infra/account-store.js';
import { get, run, all } from '../../src/infra/db.js';

beforeEach(async () => {
  await acquireDaemonLease();
  setDaemonMeta('daemon_console_url', 'http://127.0.0.1:47821');
});

function issue(accountId) {
  const link = createConsoleLink({ accountId });
  const consoleToken = new URL(link.url).pathname.split('/').at(-1);
  return { ...link, consoleToken };
}

it('uses 32-byte one-time tokens and only persists hashes for tokens and eight-hour sessions', () => {
  const { consoleToken } = issue();
  assert.equal(Buffer.from(consoleToken, 'base64url').length, 32);
  const row = get('SELECT * FROM console_tokens');
  assert.equal(row.token_hash, createHash('sha256').update(consoleToken).digest('hex'));
  assert.equal(Date.parse(row.expires_at) - Date.parse(row.created_at), 600_000);
  const { sessionValue: consoleSession, accountSlug } = redeemConsoleToken(consoleToken);
  assert.equal(Buffer.from(consoleSession, 'base64url').length, 32);
  assert.equal(accountSlug, null);
  const session = get('SELECT * FROM console_sessions');
  assert.equal(session.session_hash, createHash('sha256').update(consoleSession).digest('hex'));
  assert.equal(Date.parse(session.expires_at) - Date.parse(session.created_at), 28_800_000);
  const stored = JSON.stringify([...all('SELECT * FROM console_tokens'), ...all('SELECT * FROM console_sessions')]);
  assert.equal(stored.includes(consoleToken), false);
  assert.equal(stored.includes(consoleSession), false);
  assert.ok(resolveConsoleSession(consoleSession));
  assert.throws(() => redeemConsoleToken(consoleToken), { code: 'E_CONSOLE_LINK_GONE' });
});

it('binds the landing account without restricting an unbound console session', () => {
  const account = insertAccount({ identity: '900001', displayName: 'Shop' });
  const { consoleToken } = issue(account.id);
  const { sessionValue: consoleSession, accountSlug } = redeemConsoleToken(consoleToken);
  assert.equal(accountSlug, account.slug);
  assert.equal(resolveConsoleSession(consoleSession).account_id, account.id);
  removeAccount(account.slug);
  assert.equal(resolveConsoleSession(consoleSession), null);
});

it('rejects tokens and sessions exactly at expiry, unknown and absent cookies', () => {
  vi.useFakeTimers();
  const { consoleToken } = issue();
  const next = issue();
  const { sessionValue: consoleSession } = redeemConsoleToken(next.consoleToken);
  vi.advanceTimersByTime(600_000);
  assert.throws(() => redeemConsoleToken(consoleToken), { code: 'E_CONSOLE_LINK_EXPIRED' });
  vi.advanceTimersByTime(28_200_000);
  assert.equal(resolveConsoleSession(consoleSession), null);
  for (const consoleSession of [null, undefined, '', 'unknown', 'a'.repeat(43)]) assert.equal(resolveConsoleSession(consoleSession), null);
  assert.throws(() => redeemConsoleToken('a'.repeat(43)), { code: 'E_CONSOLE_LINK_GONE' });
  assert.throws(() => redeemConsoleToken('invalid'), { code: 'E_CONSOLE_LINK_GONE' });
});

it('rolls back consumption if session insertion fails', () => {
  const { consoleToken } = issue();
  run("CREATE TRIGGER fail_session BEFORE INSERT ON console_sessions BEGIN SELECT RAISE(ABORT, 'private detail'); END");
  assert.throws(() => redeemConsoleToken(consoleToken), { code: 'E_AUTH_STATE_IO', message: '控制台鉴权存储暂不可用' });
  assert.equal(get('SELECT consumed_at FROM console_tokens').consumed_at, null);
  run('DROP TRIGGER fail_session');
  assert.ok(redeemConsoleToken(consoleToken).sessionValue);
});

it('sets Strict HttpOnly cookies, with Secure only for the configured HTTPS public URL', () => {
  assert.equal(consoleSessionCookie('synthetic', {}), 'pdd_console=synthetic; HttpOnly; SameSite=Strict; Path=/');
  assert.match(consoleSessionCookie('synthetic', { consolePublicUrl: 'https://console.example' }), /; Secure$/);
  assert.doesNotMatch(consoleSessionCookie('synthetic', { consolePublicUrl: 'http://console.example' }), /Secure/);
});

it('requires both a running lease and a published address to issue links', () => {
  setDaemonMeta('daemon_console_url', '');
  assert.throws(() => createConsoleLink(), { code: 'E_DAEMON_NOT_RUNNING' });
  setDaemonMeta('daemon_console_url', 'http://127.0.0.1:47821');
  run("DELETE FROM leases WHERE scope = 'daemon'");
  assert.throws(() => createConsoleLink(), { code: 'E_DAEMON_NOT_RUNNING' });
});
