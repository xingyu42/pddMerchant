import { chmod, copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { platform } from 'node:os';
import { getLogger } from '../infra/logger.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { isMockEnabled, mockIsAuthValid } from './mock-dispatcher.js';
import { acquireLock, releaseLock } from './auth-lock.js';
import { DATA_DIR } from '../infra/paths.js';

const PDD_HOME = 'https://mms.pinduoduo.com';

let _tmpSeq = 0;

function legacyAuthStatePath() {
  return join(DATA_DIR, 'auth-state.json');
}

function validateShape(state) {
  if (!state || typeof state !== 'object') return false;
  if (!Array.isArray(state.cookies)) return false;
  if (!Array.isArray(state.origins)) return false;
  return true;
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
            message: `chmod 600 failed on ${tmpPath}: ${err?.message}`,
            hint: 'Set PDD_ALLOW_INSECURE_AUTH_STATE=1 to bypass (not recommended)',
            exitCode: ExitCodes.AUTH,
          });
        }
        getLogger().warn({ err: err?.message, path: tmpPath }, 'chmod 600 failed, continuing (insecure override)');
      }
    }

    await rename(tmpPath, path);
    return path;
  } finally {
    if (lockToken) {
      await releaseLock(path, lockToken).catch(() => {});
    }
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
      message: `auth-state at ${path} has invalid shape (missing cookies or origins array)`,
      hint: '执行 pdd login 重新登录以生成有效的 auth-state',
      exitCode: ExitCodes.AUTH,
    });
  }

  return { path, exists: true, state };
}

export async function migrateLegacyAuthStateIfNeeded(targetPath, warnings = []) {
  const legacy = legacyAuthStatePath();
  if (!existsSync(legacy)) return false;
  if (existsSync(targetPath)) return false;

  let legacyState;
  try {
    const raw = await readFile(legacy, 'utf8');
    legacyState = JSON.parse(raw);
  } catch {
    warnings.push('auth_state_legacy_corrupt_skipped');
    return false;
  }

  if (!validateShape(legacyState)) {
    warnings.push('auth_state_legacy_corrupt_skipped');
    return false;
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(legacy, targetPath);

  const isPosix = platform() !== 'win32';
  if (isPosix) {
    try { await chmod(targetPath, 0o600); } catch { /* best effort */ }
  }

  warnings.push('auth_state_migrated_from_legacy');
  return true;
}

export async function isAuthValid(page, { timeoutMs = 15000, maxAttempts = 2 } = {}) {
  if (isMockEnabled()) return mockIsAuthValid();
  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await page.goto(PDD_HOME, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
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

export { PDD_HOME, legacyAuthStatePath, validateShape };
