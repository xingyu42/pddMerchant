import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DB_PATH } from './paths.js';
import { PddCliError, ExitCodes } from './errors.js';

const SCHEMA_V1 = `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('merchant','consumer')),
  slug TEXT NOT NULL,
  display_name TEXT NOT NULL,
  identity TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT,
  last_used_at TEXT,
  UNIQUE (kind, slug),
  UNIQUE (kind, identity)
);
CREATE UNIQUE INDEX accounts_one_default ON accounts(kind) WHERE is_default = 1;
CREATE TABLE auth_states (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  state_sealed TEXT NOT NULL,
  bound_mall_id TEXT,
  usable INTEGER NOT NULL DEFAULT 1,
  check_verdict TEXT,
  scope TEXT,
  checked_at TEXT,
  last_check_verdict TEXT,
  last_check_reason TEXT,
  last_check_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE leases (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  owner_token TEXT NOT NULL,
  pid INTEGER NOT NULL,
  hostname TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE TABLE credentials (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  password_sealed TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE relogin_states (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('available','awaiting_human','blocked')),
  reason TEXT,
  consecutive_takeover_timeouts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE pending_actions (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','resolved')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE UNIQUE INDEX pending_actions_one_open ON pending_actions(account_id, kind) WHERE status = 'open';
`;

let database = null;
let databasePath = null;
let databaseGeneration = 0;

function executeTransaction(connection, callback) {
  connection.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    if (result != null && typeof result.then === 'function') {
      void Promise.resolve(result).catch(() => {});
      throw new PddCliError({
        code: 'E_GENERAL',
        message: '数据库事务回调必须同步完成',
        hint: '请将异步操作移至事务外执行',
        exitCode: ExitCodes.GENERAL,
      });
    }
    connection.exec('COMMIT');
    return result;
  } catch (error) {
    connection.exec('ROLLBACK');
    throw error;
  }
}

function migrate(connection) {
  executeTransaction(connection, () => {
    const version = connection.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) {
      throw new PddCliError({
        code: 'E_DATABASE_VERSION_UNSUPPORTED', message: '数据库由更新版本的 pdd-cli 创建，请升级 pdd-cli',
        hint: '请升级 pdd-cli 后重试', exitCode: ExitCodes.AUTH,
      });
    }
    if (version < 1) {
      connection.exec(SCHEMA_V1);
      connection.exec('PRAGMA user_version = 1');
    }
  });
}

function enableWal(connection) {
  const deadline = Date.now() + 5000;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (true) {
    try {
      connection.exec('PRAGMA journal_mode = WAL');
      return;
    } catch (error) {
      if (error.errcode !== 5 || Date.now() >= deadline) throw error;
      // 首次切换 WAL 的竞争可能跳过 SQLite busy handler，短暂等待后重试。
      Atomics.wait(sleeper, 0, 0, Math.min(20 + Math.floor(Math.random() * 30), deadline - Date.now()));
    }
  }
}

export function openDatabase(path = databasePath ?? DB_PATH) {
  const targetPath = resolve(path);
  if (database && targetPath === databasePath) return database;
  closeDatabase();
  let connection;
  try {
    mkdirSync(dirname(targetPath), { recursive: true });
    connection = new DatabaseSync(targetPath, { timeout: 5000 });
    enableWal(connection);
    connection.exec('PRAGMA synchronous = NORMAL');
    connection.exec('PRAGMA foreign_keys = ON');
    connection.exec('PRAGMA busy_timeout = 5000');
    migrate(connection);
  } catch (error) {
    connection?.close();
    if (error instanceof PddCliError) throw error;
    throw new PddCliError({
      code: 'E_AUTH_STATE_IO', message: '无法打开认证数据库',
      hint: '请检查数据库的访问权限和存储空间后重试', exitCode: ExitCodes.AUTH,
    });
  }
  database = connection;
  databasePath = targetPath;
  return database;
}

export function closeDatabase() {
  if (!database) return;
  database.close();
  database = null;
  databasePath = null;
  databaseGeneration += 1;
}

export function getDatabasePath() {
  return databasePath ?? DB_PATH;
}

export function getDatabaseGeneration() {
  return databaseGeneration;
}

export function isInTransaction() {
  return database?.isTransaction ?? false;
}

export function transaction(callback) {
  return executeTransaction(openDatabase(), callback);
}

export function get(sql, ...params) {
  return openDatabase().prepare(sql).get(...params);
}

export function all(sql, ...params) {
  return openDatabase().prepare(sql).all(...params);
}

export function run(sql, ...params) {
  return openDatabase().prepare(sql).run(...params);
}

process.once('exit', closeDatabase);
