import assert from 'node:assert/strict';
import { hostname } from 'node:os';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { it, vi } from 'vitest';
import { get, run, transaction, getDatabasePath, openDatabase } from '../../src/infra/db.js';
import {
  DAEMON_LEASE, acquireDaemonLease, heartbeatDaemon, releaseDaemonLease, readDaemonLease,
  requestDaemonStop, readDaemonStopRequest, clearDaemonStopRequest,
  setDaemonMeta, getDaemonMeta, purgeExpiredConsoleRows, daemonBrowserDbPrefix, daemonBrowserOwnerTag,
} from '../../src/infra/daemon-state.js';

const NOW = Date.parse('2026-10-27T00:00:00.000Z');

it('scopes bounded browser owner tags to the resolved active database path', () => {
  const path = getDatabasePath();
  const db8 = createHash('sha256').update(resolve(path)).digest('hex').slice(0, 8);
  const owner = 'abcdef0123456789abcdef0123456789ab';
  assert.equal(daemonBrowserDbPrefix(), db8);
  assert.equal(daemonBrowserOwnerTag(owner), `${db8}-${owner.slice(0, 23)}`);
  assert.match(daemonBrowserOwnerTag(owner), /^[a-z0-9-]{1,32}$/);
  openDatabase(join(dirname(path), 'other.db'));
  assert.notEqual(daemonBrowserDbPrefix(), db8);
  assert.notEqual(daemonBrowserOwnerTag(owner), `${db8}-${owner.slice(0, 23)}`);
});

it('acquires one daemon instance and projects lease status without its owner token', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  assert.deepEqual(DAEMON_LEASE, { scope: 'daemon', key: 'main', ttlMs: 90_000, heartbeatMs: 30_000 });
  assert.equal(readDaemonLease(), null);
  const lease = await acquireDaemonLease();
  assert.equal(typeof lease.token, 'string');
  assert.equal(await acquireDaemonLease(), null);
  assert.deepEqual(readDaemonLease(), {
    running: true, pid: process.pid, hostname: hostname(),
    acquired_at: new Date(NOW).toISOString(), heartbeat_at: new Date(NOW).toISOString(),
    expires_at: new Date(NOW + 90_000).toISOString(),
  });
  assert.equal(releaseDaemonLease('other-owner'), false);
  assert.equal(releaseDaemonLease(lease.token), true);
  assert.equal(readDaemonLease(), null);
});

it('renews for 90 seconds and permits heartbeat takeover at expiry with a live pid', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const first = await acquireDaemonLease();
  clock.mockReturnValue(NOW + 30_000);
  assert.equal(heartbeatDaemon(first.token).changes, 1);
  assert.equal(readDaemonLease().expires_at, new Date(NOW + 120_000).toISOString());
  assert.equal(readDaemonLease().heartbeat_at, new Date(NOW + 30_000).toISOString());
  assert.equal(readDaemonLease().acquired_at, new Date(NOW).toISOString());
  clock.mockReturnValue(NOW + 119_999);
  assert.equal(readDaemonLease().running, true);
  assert.equal(await acquireDaemonLease(), null);
  clock.mockReturnValue(NOW + 120_000);
  assert.equal(readDaemonLease().running, false);
  const second = await acquireDaemonLease();
  assert.notEqual(first.token, second.token);
  assert.throws(() => heartbeatDaemon(first.token), { code: 'E_AUTH_LOCK_LOST' });
  assert.equal(releaseDaemonLease(first.token), false);
  assert.equal(readDaemonLease().running, true);
});

it('writes, reads and clears a stop request idempotently', () => {
  vi.useFakeTimers({ now: NOW });
  assert.equal(readDaemonStopRequest(), null);
  const requestedAt = requestDaemonStop();
  assert.equal(requestedAt, new Date(NOW).toISOString());
  assert.equal(readDaemonStopRequest(), requestedAt);
  assert.equal(clearDaemonStopRequest(), true);
  assert.equal(clearDaemonStopRequest(), false);
  assert.equal(readDaemonStopRequest(), null);
});

it.each(['daemon_last_patrol_at', 'daemon_console_url'])('upserts %s within short existing transactions', (key) => {
  assert.equal(getDaemonMeta(key), null);
  setDaemonMeta(key, 'first');
  transaction(() => setDaemonMeta(key, 'second'));
  assert.equal(getDaemonMeta(key), 'second');
  assert.equal(get('SELECT count(*) AS count FROM meta WHERE key = ?', key).count, 1);
});

it('limits daemon metadata to its owned keys and hides raw database failures', async () => {
  assert.throws(() => setDaemonMeta('master_key_fingerprint', 'private'), { code: 'E_USAGE' });
  assert.throws(() => getDaemonMeta('private'), { code: 'E_USAGE' });
  run('DROP TABLE leases');
  await assert.rejects(acquireDaemonLease(), { code: 'E_AUTH_STATE_IO', message: 'daemon 状态存储暂不可用' });
  assert.throws(() => readDaemonLease(), { code: 'E_AUTH_STATE_IO' });
  run('DROP TABLE meta');
  assert.throws(() => requestDaemonStop(), { code: 'E_AUTH_STATE_IO' });
  assert.throws(() => getDaemonMeta('daemon_console_url'), { code: 'E_AUTH_STATE_IO' });
});

function seedConsoleRows() {
  for (const [name, offset] of [['expired', -1], ['boundary', 0], ['future', 1], ['consumed', 1]]) {
    const expiresAt = new Date(NOW + offset).toISOString();
    run('INSERT INTO console_tokens VALUES (?, NULL, ?, ?, ?)', name, new Date(NOW).toISOString(), expiresAt,
      name === 'consumed' ? new Date(NOW).toISOString() : null);
    run('INSERT INTO console_sessions VALUES (?, NULL, ?, ?)', name, new Date(NOW).toISOString(), expiresAt);
  }
}

it('purges expired tokens and sessions including the exact expiry boundary', () => {
  seedConsoleRows();
  assert.deepEqual(purgeExpiredConsoleRows(NOW), { tokens: 2, sessions: 2 });
  assert.equal(get('SELECT count(*) AS count FROM console_tokens').count, 2);
  assert.equal(get('SELECT count(*) AS count FROM console_sessions').count, 2);
  assert.deepEqual(purgeExpiredConsoleRows(NOW), { tokens: 0, sessions: 0 });
  vi.spyOn(Date, 'now').mockReturnValue(NOW + 1);
  assert.deepEqual(purgeExpiredConsoleRows(), { tokens: 2, sessions: 2 });
});

it('rolls back token deletion when session cleanup fails', () => {
  seedConsoleRows();
  run('DROP TABLE console_sessions');
  assert.throws(() => purgeExpiredConsoleRows(NOW), { code: 'E_AUTH_STATE_IO' });
  assert.equal(get('SELECT count(*) AS count FROM console_tokens').count, 4);
});
