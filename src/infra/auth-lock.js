import { writeFile, readFile, unlink, rename, mkdir, link } from 'node:fs/promises';
import { dirname } from 'node:path';
import { abortableSleep, throwIfAborted } from './abort.js';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { PddCliError, ExitCodes } from './errors.js';
import { isPidAlive } from './process-util.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STALE_MS = 120_000;
const DEFAULT_RETRY_MS = 200;

function lockPath(authStatePath) {
  return `${authStatePath}.lock`;
}

export function isLockStale(lockData, { staleMs = DEFAULT_STALE_MS, now = Date.now() } = {}) {
  if (!lockData || typeof lockData !== 'object') return true;
  if (Number.isSafeInteger(lockData.pid) && lockData.pid > 0 && lockData.hostname === hostname()) {
    return !isPidAlive(lockData.pid);
  }
  return typeof lockData.createdAt === 'number' && (now - lockData.createdAt) > staleMs;
}

function readLockFile(path) {
  return readFile(path, 'utf8').then((raw) => JSON.parse(raw));
}

async function restoreLockIfAbsent(quarantine, original) {
  try {
    // link is create-only: never overwrite a newer owner while restoring a raced lock.
    await link(quarantine, original);
    await unlink(quarantine);
  } catch { /* Keep the quarantined file when another owner already exists. */ }
}

async function tryRemoveStaleLock(path, opts) {
  let data;
  try {
    data = await readLockFile(path);
  } catch {
    return false;
  }

  if (!isLockStale(data, opts)) return false;

  const quarantine = `${path}.stale-${randomUUID()}`;
  try {
    await rename(path, quarantine);
  } catch {
    return false;
  }

  try {
    const movedData = await readLockFile(quarantine);
    if (movedData.token === data.token) {
      await unlink(quarantine).catch(() => {});
      return true;
    }
    await restoreLockIfAbsent(quarantine, path);
    return false;
  } catch {
    await restoreLockIfAbsent(quarantine, path);
    return false;
  }
}

export async function acquireLock(
  authStatePath,
  { timeoutMs = DEFAULT_TIMEOUT_MS, staleMs = DEFAULT_STALE_MS, retryMs = DEFAULT_RETRY_MS, signal } = {},
) {
  await mkdir(dirname(authStatePath), { recursive: true });
  const lp = lockPath(authStatePath);
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const lockData = JSON.stringify({
      pid: process.pid,
      token,
      createdAt: Date.now(),
      hostname: hostname(),
    });

    try {
      await writeFile(lp, lockData, { flag: 'wx' });
      return { token };
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
    }

    const removed = await tryRemoveStaleLock(lp, { staleMs });
    if (removed) continue;

    const jitter = Math.floor(Math.random() * 100);
    await abortableSleep(Math.min(retryMs + jitter, Math.max(1, deadline - Date.now())), signal);
  }

  throw new PddCliError({
    code: 'E_LOCK_TIMEOUT',
    message: `Failed to acquire auth-state lock within ${timeoutMs}ms`,
    hint: 'Another process may be writing auth-state.json. Check for stale .lock files.',
    exitCode: ExitCodes.GENERAL,
  });
}

export async function releaseLock(authStatePath, token) {
  const lp = lockPath(authStatePath);
  try {
    const current = await readLockFile(lp);
    if (current.token !== token || current.pid !== process.pid) return false;
  } catch (error) { return error?.code === 'ENOENT'; }
  const quarantine = `${lp}.release-${token.slice(0, 8)}`;
  try {
    await rename(lp, quarantine);
  } catch (err) {
    if (err?.code === 'ENOENT') return true;
    return false;
  }

  try {
    const data = await readLockFile(quarantine);
    if (data.token !== token) {
      await restoreLockIfAbsent(quarantine, lp);
      return false;
    }
    await unlink(quarantine).catch(() => {});
    return true;
  } catch {
    await restoreLockIfAbsent(quarantine, lp);
    return false;
  }
}

export async function assertLockOwner(authStatePath, token) {
  let data;
  try { data = await readLockFile(lockPath(authStatePath)); } catch { /* lost ownership */ }
  if (!data || data.token !== token || data.pid !== process.pid) {
    throw new PddCliError({ code: 'E_AUTH_LOCK_LOST', message: '认证任务不再拥有更新资格', exitCode: ExitCodes.AUTH });
  }
}

export { lockPath, DEFAULT_TIMEOUT_MS, DEFAULT_STALE_MS, DEFAULT_RETRY_MS };
