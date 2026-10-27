import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { get, run, transaction } from './db.js';
import { abortableSleep, throwIfAborted } from './abort.js';
import { PddCliError, ExitCodes } from './errors.js';

const DEFAULT_TIMEOUT_MS = 30_000;

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function isStale(lease, now) {
  if (lease.hostname === hostname() && Number.isSafeInteger(lease.pid) && lease.pid > 0) {
    return !isPidAlive(lease.pid);
  }
  return Date.parse(lease.expires_at) <= now;
}

function tryAcquire(scope, key, token, ttlMs, signal) {
  return transaction(() => {
    throwIfAborted(signal);
    const now = Date.now();
    const existing = get('SELECT * FROM leases WHERE scope = ? AND key = ?', scope, key);
    if (existing && !isStale(existing, now)) return false;
    const acquiredAt = new Date(now).toISOString();
    run(`INSERT INTO leases (scope, key, owner_token, pid, hostname, acquired_at, expires_at, heartbeat_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, key) DO UPDATE SET owner_token = excluded.owner_token, pid = excluded.pid,
        hostname = excluded.hostname, acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at, heartbeat_at = excluded.heartbeat_at`,
    scope, key, token, process.pid, hostname(), acquiredAt, new Date(now + ttlMs).toISOString(), acquiredAt);
    return true;
  });
}

export async function acquireLease(scope, key, {
  timeoutMs = DEFAULT_TIMEOUT_MS, retryMs = 200, ttlMs = timeoutMs + 30_000, signal,
} = {}) {
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;
  throwIfAborted(signal);
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    if (tryAcquire(scope, String(key), token, ttlMs, signal)) return { token };
    const jitter = Math.floor(Math.random() * 100);
    await abortableSleep(Math.min(retryMs + jitter, Math.max(1, deadline - Date.now())), signal);
  }
  throwIfAborted(signal);
  throw new PddCliError({
    code: 'E_LOCK_TIMEOUT',
    message: `在 ${timeoutMs}ms 内获取认证租约超时`,
    hint: '其他进程可能正在更新认证数据，请等待任务结束后重试',
    exitCode: ExitCodes.GENERAL,
  });
}

export function renewLease(scope, key, token, { ttlMs = DEFAULT_TIMEOUT_MS + 30_000 } = {}) {
  return transaction(() => {
    assertLeaseOwner(scope, key, token);
    const now = Date.now();
    return run('UPDATE leases SET expires_at = ?, heartbeat_at = ? WHERE scope = ? AND key = ? AND owner_token = ?',
      new Date(now + ttlMs).toISOString(), new Date(now).toISOString(), scope, String(key), token);
  });
}

export function releaseLease(scope, key, token) {
  return transaction(() => run(
    'DELETE FROM leases WHERE scope = ? AND key = ? AND owner_token = ? AND pid = ? AND hostname = ?',
    scope, String(key), token, process.pid, hostname(),
  ).changes > 0);
}

export function assertLeaseOwner(scope, key, token) {
  const lease = get('SELECT owner_token, pid, hostname FROM leases WHERE scope = ? AND key = ?', scope, String(key));
  if (!lease || lease.owner_token !== token || lease.pid !== process.pid || lease.hostname !== hostname()) {
    throw new PddCliError({ code: 'E_AUTH_LOCK_LOST', message: '认证任务不再拥有更新资格', exitCode: ExitCodes.AUTH });
  }
}
