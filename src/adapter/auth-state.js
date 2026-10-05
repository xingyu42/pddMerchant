import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { platform } from 'node:os';
import { createHash } from 'node:crypto';
import { getLogger } from '../infra/logger.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { isMockEnabled, mockIsConsumerAuthValid } from './mock-dispatcher.js';
import { acquireLock, releaseLock } from '../infra/auth-lock.js';

const PDD_HOME = 'https://mms.pinduoduo.com';

let _tmpSeq = 0;

function validateShape(state) {
  if (!state || typeof state !== 'object') return false;
  if (!Array.isArray(state.cookies)) return false;
  if (!Array.isArray(state.origins)) return false;
  return true;
}

function revisionOf(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

export async function getAuthStateRevision(path) {
  try {
    return revisionOf(await readFile(path));
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

// POSIX 下凭据临时文件必须收紧到 0600；PDD_ALLOW_INSECURE_AUTH_STATE=1 时仅告警继续。
async function restrictTmpPermissions(tmpPath) {
  if (platform() === 'win32') return;
  try {
    await chmod(tmpPath, 0o600);
  } catch (err) {
    if (process.env.PDD_ALLOW_INSECURE_AUTH_STATE !== '1') {
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

export async function saveAuthState(context, path) {
  await mkdir(dirname(path), { recursive: true });
  const { token: lockToken } = await acquireLock(path, { timeoutMs: 15_000 });

  try {
    const tmpPath = `${path}.${process.pid}.${++_tmpSeq}.tmp`;
    await context.storageState({ path: tmpPath });
    try {
      await restrictTmpPermissions(tmpPath);
    } catch (err) {
      await unlink(tmpPath).catch(() => {});
      throw err;
    }
    await rename(tmpPath, path);
    return path;
  } finally {
    await releaseLock(path, lockToken).catch((err) => {
      getLogger().warn({ code: err?.code ?? null, auth_path: path }, 'auth-state: lock release failed');
    });
  }
}

// 调用方须已持有 path 的认证锁；返回写入内容的修订号，免去写后回读。
export async function saveAuthStateSnapshot(state, path, { beforeCommit } = {}) {
  if (!validateShape(state)) {
    throw new PddCliError({ code: 'E_AUTH_STATE_CORRUPT', message: '冻结登录材料格式无效', exitCode: ExitCodes.AUTH });
  }
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${++_tmpSeq}.tmp`;
  const raw = Buffer.from(JSON.stringify(state), 'utf8');
  try {
    await writeFile(tmpPath, raw, { mode: 0o600, flag: 'wx' });
    await restrictTmpPermissions(tmpPath);
    if (beforeCommit) await beforeCommit();
    await rename(tmpPath, path);
    return revisionOf(raw);
  } catch (error) {
    if (error instanceof PddCliError) throw error;
    throw new PddCliError({ code: 'E_AUTH_STATE_SAVE_FAILED', message: '登录材料未能保存', detail: { fs_code: error?.code ?? null }, exitCode: ExitCodes.AUTH });
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

export async function loadAuthState(path) {
  if (!existsSync(path)) {
    return { path, exists: false, state: null };
  }
  return { path, exists: true, state: parseAuthState(await readFile(path, 'utf8')) };
}

// 单次读取同时得到解析结果与修订号（与 getAuthStateRevision 同一哈希）。
export async function loadAuthStateWithRevision(path, { allowCorrupt = false } = {}) {
  let raw;
  try { raw = await readFile(path); }
  catch (err) {
    if (err?.code === 'ENOENT') return { state: null, revision: null };
    throw err;
  }
  const state = parseAuthState(raw.toString('utf8'), { allowCorrupt });
  return { state, revision: revisionOf(raw), corrupt: !validateShape(state) };
}

function parseAuthState(raw, { allowCorrupt = false } = {}) {
  let state;
  try { state = JSON.parse(raw); }
  catch {
    if (allowCorrupt) return null;
    throw new PddCliError({ code: 'E_AUTH_STATE_CORRUPT', message: '登录凭据文件不是有效 JSON', exitCode: ExitCodes.AUTH });
  }

  if (!validateShape(state) && !allowCorrupt) {
    throw new PddCliError({
      code: 'E_AUTH_STATE_CORRUPT',
      message: '登录凭据格式无效（缺少 cookies 或 origins）',
      hint: '执行 pdd login 重新登录以生成有效的 auth-state',
      detail: { reason: 'shape_invalid' },
      exitCode: ExitCodes.AUTH,
    });
  }
  return state;
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
