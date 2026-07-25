import { chmod, mkdir, readFile, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { platform } from 'node:os';
import { createHash } from 'node:crypto';
import { getLogger } from '../infra/logger.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { isMockEnabled, mockIsAuthValid, mockIsConsumerAuthValid } from './mock-dispatcher.js';
import { acquireLock, releaseLock } from '../infra/auth-lock.js';

const PDD_HOME = 'https://mms.pinduoduo.com';

let _tmpSeq = 0;

function validateShape(state) {
  if (!state || typeof state !== 'object') return false;
  if (!Array.isArray(state.cookies)) return false;
  if (!Array.isArray(state.origins)) return false;
  return true;
}

export async function getAuthStateRevision(path) {
  try {
    const raw = await readFile(path);
    return createHash('sha256').update(raw).digest('hex');
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

export async function saveAuthState(context, path, { skipLock = false } = {}) {
  await mkdir(dirname(path), { recursive: true });

  let lockToken = null;
  if (!skipLock) {
    const lock = await acquireLock(path, { timeoutMs: 15_000 });
    lockToken = lock.token;
  }

  try {
    const tmpPath = `${path}.${process.pid}.${++_tmpSeq}.tmp`;
    await context.storageState({ path: tmpPath });

    const isPosix = platform() !== 'win32';
    if (isPosix) {
      const allowInsecure = process.env.PDD_ALLOW_INSECURE_AUTH_STATE === '1';
      try {
        await chmod(tmpPath, 0o600);
      } catch (err) {
        try { await unlink(tmpPath); } catch { /* ignore */ }
        if (!allowInsecure) {
          throw new PddCliError({
            code: 'E_AUTH_STATE_INSECURE',
            message: '登录凭据文件权限设置失败',
            hint: 'Set PDD_ALLOW_INSECURE_AUTH_STATE=1 to bypass (not recommended)',
            detail: { fs_code: err?.code ?? null },
            exitCode: ExitCodes.AUTH,
          });
        }
        getLogger().warn({ code: err?.code ?? null, auth_path: tmpPath }, 'chmod 600 failed, continuing (insecure override)');
      }
    }

    await rename(tmpPath, path);
    return path;
  } finally {
    if (lockToken) {
      await releaseLock(path, lockToken).catch((err) => {
        getLogger().warn({ code: err?.code ?? null, auth_path: path }, 'auth-state: lock release failed');
      });
    }
  }
}

export async function saveAuthStateIfCurrent(context, path, expectedRevision) {
  await mkdir(dirname(path), { recursive: true });
  const lock = await acquireLock(path, { timeoutMs: 15_000 });

  try {
    const currentRevision = await getAuthStateRevision(path);
    if (currentRevision !== expectedRevision) {
      return { saved: false, reason: 'conflict' };
    }

    await saveAuthState(context, path, { skipLock: true });
    return { saved: true, reason: 'saved' };
  } finally {
    await releaseLock(path, lock.token).catch((err) => {
      getLogger().warn({ code: err?.code ?? null, auth_path: path }, 'auth-state: lock release failed');
    });
  }
}

export async function loadAuthState(path) {
  if (!existsSync(path)) {
    return { path, exists: false, state: null };
  }
  const raw = await readFile(path, 'utf8');
  const state = JSON.parse(raw);

  if (!validateShape(state)) {
    throw new PddCliError({
      code: 'E_AUTH_STATE_CORRUPT',
      message: '登录凭据格式无效（缺少 cookies 或 origins）',
      hint: '执行 pdd login 重新登录以生成有效的 auth-state',
      detail: { reason: 'shape_invalid' },
      exitCode: ExitCodes.AUTH,
    });
  }

  return { path, exists: true, state };
}

export async function deleteAuthState(path) {
  try {
    await unlink(path);
    return { removed: true, existed: true };
  } catch (err) {
    if (err?.code === 'ENOENT') return { removed: true, existed: false };
    throw new PddCliError({
      code: 'E_AUTH_STATE_DELETE_FAILED',
      message: '删除登录凭据失败',
      hint: '停止使用当前账号并检查登录态文件权限后重试',
      detail: { fs_code: err?.code ?? null },
      exitCode: ExitCodes.AUTH,
    });
  }
}

export async function isAuthValid(page, { timeoutMs = 15000, maxAttempts = 2 } = {}) {
  if (isMockEnabled()) return mockIsAuthValid();
  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await page.goto(PDD_HOME, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      const finalUrl = page.url();
      if (finalUrl.includes('/login')) return false;
      if (resp && !resp.ok() && resp.status() >= 400) return false;
      return true;
    } catch (err) {
      lastErr = err;
      getLogger().debug({ err: err?.message, attempt, maxAttempts }, 'isAuthValid navigation failed');
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  getLogger().debug({ err: lastErr?.message, attempts: maxAttempts }, 'isAuthValid all attempts failed');
  return false;
}

export { PDD_HOME, validateShape };

const CONSUMER_HOME = 'https://mobile.yangkeduo.com';

export async function isConsumerAuthValid(page, { timeoutMs = 15000 } = {}) {
  if (isMockEnabled()) return mockIsConsumerAuthValid();
  try {
    await page.goto(CONSUMER_HOME, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const finalUrl = page.url();
    return !finalUrl.includes('/login');
  } catch (err) {
    getLogger().debug({ err: err?.message }, 'isConsumerAuthValid navigation failed');
    return false;
  }
}

export { CONSUMER_HOME };
