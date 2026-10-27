import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { get, run, transaction, openDatabase, getDatabasePath, getDatabaseGeneration, isInTransaction } from './db.js';
import { masterKeyMissing, masterKeyMismatch, masterKeyInsecure, PddCliError, ExitCodes } from './errors.js';
import { getLogger } from './logger.js';

let verifiedKey = null;

function masterKeyPath(databasePath) {
  return join(dirname(databasePath), 'master.key');
}

function readKeyFile(path) {
  let content;
  try {
    if (process.platform !== 'win32' && (statSync(path).mode & 0o7777) !== 0o600) {
      throw masterKeyInsecure();
    }
    content = readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof PddCliError || error?.code === 'ENOENT') throw error;
    throw keyAccessFailed();
  }
  try {
    const stored = JSON.parse(content);
    const key = Buffer.from(stored.key, 'base64');
    if (stored.version !== 1 || key.length !== 32 || key.toString('base64') !== stored.key) {
      throw masterKeyMismatch();
    }
    return key;
  } catch {
    throw masterKeyMismatch();
  }
}

function keyAccessFailed() {
  return new PddCliError({
    code: 'E_AUTH_STATE_IO', message: '无法访问认证主密钥',
    hint: '请检查主密钥文件的访问权限和存储空间后重试', exitCode: ExitCodes.AUTH,
  });
}

function createOrReadKey(path, initialized) {
  try {
    return { key: readKeyFile(path), created: false };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    if (initialized) throw masterKeyMissing();
  }
  const key = randomBytes(32);
  try {
    writeFileSync(path, JSON.stringify({ version: 1, key: key.toString('base64') }), { flag: 'wx', mode: 0o600 });
    if (process.platform === 'win32') restrictWindowsAccess(path);
    return { key, created: true };
  } catch (error) {
    if (error instanceof PddCliError) throw error;
    if (error?.code !== 'EEXIST') throw keyAccessFailed();
    return { key: readKeyFile(path), created: false };
  }
}

function initializeKey(path) {
  const stored = get('SELECT value FROM meta WHERE key = ?', 'master_key_fingerprint');
  const result = createOrReadKey(path, stored !== undefined);
  const fingerprint = createHash('sha256').update(result.key).digest('hex').slice(0, 16);
  if (stored && stored.value !== fingerprint) throw masterKeyMismatch();
  if (!stored) run('INSERT INTO meta (key, value) VALUES (?, ?)', 'master_key_fingerprint', fingerprint);
  return result;
}

function restrictWindowsAccess(path) {
  const warn = () => getLogger().warn({ code: 'master_key_acl_failed' }, '主密钥文件 ACL 设置失败，请检查文件权限');
  try {
    const executable = join(process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows', 'System32', 'icacls.exe');
    execFileSync(executable, [path, '/inheritance:r', '/grant:r', `${userInfo().username}:F`],
      { windowsHide: true, timeout: 5000, stdio: 'ignore' });
  } catch {
    warn();
  }
}

export function getMasterKey() {
  openDatabase();
  const databasePath = getDatabasePath();
  const generation = getDatabaseGeneration();
  if (verifiedKey?.databasePath === databasePath && verifiedKey.generation === generation) return verifiedKey.key;
  const path = masterKeyPath(databasePath);
  // 已有写事务时复用它；首次创建在短事务内串行化，避免读到另一进程尚未写完的文件。
  const result = isInTransaction() ? initializeKey(path) : transaction(() => initializeKey(path));
  verifiedKey = { databasePath, generation, key: result.key };
  return result.key;
}
