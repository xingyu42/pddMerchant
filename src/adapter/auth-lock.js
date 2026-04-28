import { writeFile, readFile, unlink, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { isPidAlive } from '../infra/process-util.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STALE_MS = 120_000;
const DEFAULT_RETRY_MS = 200;

function lockPath(authStatePath) {
  return `${authStatePath}.lock`;
}

export function isLockStale(lockData, { staleMs = DEFAULT_STALE_MS, now = Date.now() } = {}) {
  if (!lockData || typeof lockData !== 'object') return true;
  if (typeof lockData.createdAt === 'number' && (now - lockData.createdAt) > staleMs) return true;
  if (typeof lockData.pid === 'number' && !isPidAlive(lockData.pid)) return true;
  return false;
}

function readLockFile(path) {
  return readFile(path, 'utf8').then((raw) => JSON.parse(raw));
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
    await rename(quarantine, path).catch(() => {});
    return false;
  } catch {
    await unlink(quarantine).catch(() => {});
    return true;
  }
}

export async function acquireLock(
  authStatePath,
  { timeoutMs = DEFAULT_TIMEOUT_MS, staleMs = DEFAULT_STALE_MS, retryMs = DEFAULT_RETRY_MS } = {},
) {
  const lp = lockPath(authStatePath);
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
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
    await new Promise((r) => setTimeout(r, retryMs + jitter));
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
      await rename(quarantine, lp).catch(() => {});
      return false;
    }
    await unlink(quarantine).catch(() => {});
    return true;
  } catch {
    await unlink(quarantine).catch(() => {});
    return true;
  }
}

export { lockPath, DEFAULT_TIMEOUT_MS, DEFAULT_STALE_MS, DEFAULT_RETRY_MS };
