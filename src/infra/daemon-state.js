import { get, run, transaction, isInTransaction } from './db.js';
import { acquireLease, isLeaseStale, renewLease } from './leases.js';
import { hostname } from 'node:os';
import { PddCliError, ExitCodes } from './errors.js';

export const DAEMON_LEASE = Object.freeze({ scope: 'daemon', key: 'main', ttlMs: 90_000, heartbeatMs: 30_000 });
const META_KEYS = new Set(['daemon_last_patrol_at', 'daemon_console_url']);
const STOP_KEY = 'daemon_stop_requested_at';

function storageOperation(callback) {
  try { return callback(); }
  catch (error) {
    if (error instanceof PddCliError) throw error;
    throw new PddCliError({ code: 'E_AUTH_STATE_IO', message: 'daemon 状态存储暂不可用', exitCode: ExitCodes.AUTH });
  }
}

function write(callback) {
  return storageOperation(() => isInTransaction() ? callback() : transaction(callback));
}

export async function acquireDaemonLease({ ttlMs = DAEMON_LEASE.ttlMs } = {}) {
  try {
    return await acquireLease(DAEMON_LEASE.scope, DAEMON_LEASE.key, {
      staleBy: 'heartbeat', ttlMs, timeoutMs: 0,
    });
  } catch (error) {
    if (error instanceof PddCliError && error.code === 'E_LOCK_TIMEOUT') return null;
    return storageOperation(() => { throw error; });
  }
}

export function heartbeatDaemon(token, { ttlMs = DAEMON_LEASE.ttlMs } = {}) {
  return storageOperation(() => renewLease(DAEMON_LEASE.scope, DAEMON_LEASE.key, token, { ttlMs }));
}

export function releaseDaemonLease(token, { clearStop = false } = {}) {
  return write(() => {
    const released = run('DELETE FROM leases WHERE scope = ? AND key = ? AND owner_token = ? AND pid = ? AND hostname = ?',
      DAEMON_LEASE.scope, DAEMON_LEASE.key, token, process.pid, hostname()).changes > 0;
    if (released && clearStop) clearDaemonStopRequest();
    return released;
  });
}

// Internal identity stays out of status views and envelopes.
export function readDaemonOwnerToken() {
  return storageOperation(() => get('SELECT owner_token FROM leases WHERE scope = ? AND key = ?',
    DAEMON_LEASE.scope, DAEMON_LEASE.key)?.owner_token ?? null);
}

export function withDaemonLeaseOwner(token, callback) {
  return write(() => {
    if (readDaemonOwnerToken() !== token) return false;
    return callback();
  });
}

export function deleteDaemonLease(token) {
  return write(() => {
    const removed = run('DELETE FROM leases WHERE scope = ? AND key = ? AND owner_token = ?',
      DAEMON_LEASE.scope, DAEMON_LEASE.key, token).changes > 0;
    if (removed) clearDaemonStopRequest();
    return removed;
  });
}

export function readDaemonLease() {
  return storageOperation(() => {
    const row = get('SELECT * FROM leases WHERE scope = ? AND key = ?', DAEMON_LEASE.scope, DAEMON_LEASE.key);
    if (!row) return null;
    const { pid, hostname, acquired_at, heartbeat_at, expires_at } = row;
    return { running: !isLeaseStale(row, { staleBy: 'heartbeat' }), pid, hostname, acquired_at, heartbeat_at, expires_at };
  });
}

function putMeta(key, value) {
  return write(() => run(`INSERT INTO meta(key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value));
}

function readMeta(key) {
  return storageOperation(() => get('SELECT value FROM meta WHERE key = ?', key)?.value ?? null);
}

export function requestDaemonStop() {
  const requestedAt = new Date().toISOString();
  putMeta(STOP_KEY, requestedAt);
  return requestedAt;
}

export function readDaemonStopRequest() {
  return readMeta(STOP_KEY);
}

export function clearDaemonStopRequest() {
  return write(() => run('DELETE FROM meta WHERE key = ?', STOP_KEY).changes > 0);
}

function assertMetaKey(key) {
  if (!META_KEYS.has(key)) {
    throw new PddCliError({ code: 'E_USAGE', message: 'daemon 元数据键无效', exitCode: ExitCodes.USAGE });
  }
}

export function setDaemonMeta(key, value) {
  assertMetaKey(key);
  return putMeta(key, value);
}

export function getDaemonMeta(key) {
  assertMetaKey(key);
  return readMeta(key);
}

export function purgeExpiredConsoleRows(now = Date.now()) {
  const expiresAt = new Date(now).toISOString();
  return write(() => ({
    tokens: run('DELETE FROM console_tokens WHERE julianday(expires_at) <= julianday(?)', expiresAt).changes,
    sessions: run('DELETE FROM console_sessions WHERE julianday(expires_at) <= julianday(?)', expiresAt).changes,
  }));
}
