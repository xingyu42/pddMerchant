import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { all, closeDatabase, get, isInTransaction, openDatabase, run, transaction } from '../../src/infra/db.js';
import { PddCliError } from '../../src/infra/errors.js';

const NOW = '2026-01-01T00:00:00.000Z';
let root;
let dbPath;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pdd-db-test-'));
  dbPath = join(root, 'pdd.db');
  openDatabase(dbPath);
});

afterEach(() => {
  try {
    closeDatabase();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function insertAccount(slug, { kind = 'merchant', isDefault = 0 } = {}) {
  return Number(run(`INSERT INTO accounts
    (kind, slug, display_name, identity, is_default, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, kind, slug, slug, `identity-${slug}`, isDefault, NOW, NOW).lastInsertRowid);
}

function insertPending(accountId, kind, status = 'open') {
  return run(`INSERT INTO pending_actions (account_id, kind, reason, status, created_at)
    VALUES (?, ?, ?, ?, ?)`, accountId, kind, 'synthetic reason', status, NOW);
}

describe('database', () => {
  it.each(['mkdir', 'open'])('hides paths when database %s fails', (operation) => {
    const blocked = join(root, 'private-blocked-parent');
    writeFileSync(blocked, 'synthetic');
    const target = operation === 'mkdir' ? join(blocked, 'pdd.db') : root;
    assert.throws(() => openDatabase(target), (error) => {
      assert.ok(error instanceof PddCliError);
      assert.equal(error.code, 'E_AUTH_STATE_IO');
      assert.equal(error.exitCode, 3);
      const output = JSON.stringify({ message: error.message, hint: error.hint, detail: error.detail });
      for (const fragment of [root, root.replaceAll('\\', '/'), 'private-blocked-parent', 'pdd.db']) {
        assert.equal(output.includes(fragment), false);
      }
      return true;
    });
  });

  it('refuses a newer schema version with a path-free upgrade error', () => {
    openDatabase().exec('PRAGMA user_version = 4');
    closeDatabase();
    assert.throws(() => openDatabase(dbPath), (error) => {
      assert.ok(error instanceof PddCliError);
      assert.equal(error.code, 'E_DATABASE_VERSION_UNSUPPORTED');
      assert.equal(error.exitCode, 3);
      assert.equal(error.message, '数据库由更新版本的 pdd-cli 创建，请升级 pdd-cli');
      const output = JSON.stringify([error.message, error.hint, error.detail]);
      for (const fragment of [root, root.replaceAll('\\', '/'), 'pdd.db']) assert.equal(output.includes(fragment), false);
      return true;
    });
  });

  it('migrates to v3 idempotently across reopen and preserves existing rows', () => {
    const expectedTables = ['accounts', 'auth_states', 'console_sessions', 'console_tokens', 'credentials', 'goods_cost_entries', 'leases', 'meta', 'pending_actions', 'relogin_states'];
    assert.equal(get('PRAGMA user_version').user_version, 3);
    assert.deepEqual(all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((row) => row.name), expectedTables);
    run('INSERT INTO meta (key, value) VALUES (?, ?)', 'migration-sentinel', 'preserved');
    const schema = all('SELECT type, name, sql FROM sqlite_master ORDER BY type, name');

    closeDatabase();
    openDatabase(dbPath);

    assert.equal(get('PRAGMA user_version').user_version, 3);
    assert.deepEqual(all('SELECT type, name, sql FROM sqlite_master ORDER BY type, name'), schema);
    assert.equal(get('SELECT value FROM meta WHERE key = ?', 'migration-sentinel').value, 'preserved');
  });

  it('upgrades a v1 database with an additive migration preserving every existing table', () => {
    openDatabase().exec('DROP TABLE IF EXISTS goods_cost_entries; DROP TABLE console_tokens; DROP TABLE console_sessions; PRAGMA user_version = 1');
    const accountId = insertAccount('existing', { isDefault: 1 });
    run('INSERT INTO meta(key, value) VALUES (?, ?)', 'migration-sentinel', 'preserved');
    run('INSERT INTO auth_states(account_id, revision, state_sealed, updated_at) VALUES (?, 7, ?, ?)', accountId, 'sealed-state', NOW);
    run('INSERT INTO credentials(account_id, password_sealed, updated_at) VALUES (?, ?, ?)', accountId, 'sealed-password', NOW);
    run('INSERT INTO relogin_states(account_id, status, updated_at) VALUES (?, ?, ?)', accountId, 'blocked', NOW);
    insertPending(accountId, 'human_takeover');
    run(`INSERT INTO leases VALUES ('account', ?, 'owner', 1, 'host', ?, ?, ?)`, String(accountId), NOW, NOW, NOW);
    const tables = all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((row) => row.name);
    const before = tables.map((table) => all(`SELECT * FROM ${table}`));
    const schema = all('SELECT type, name, sql FROM sqlite_master ORDER BY type, name');
    closeDatabase();
    openDatabase(dbPath);
    assert.equal(get('PRAGMA user_version').user_version, 3);
    assert.deepEqual(tables.map((table) => all(`SELECT * FROM ${table}`)), before);
    const upgraded = all('SELECT type, name, sql FROM sqlite_master ORDER BY type, name');
    for (const row of schema) assert.ok(upgraded.some((candidate) => JSON.stringify(candidate) === JSON.stringify(row)));
    assert.ok(get("SELECT name FROM sqlite_master WHERE name = 'console_tokens'"));
    assert.ok(get("SELECT name FROM sqlite_master WHERE name = 'console_sessions'"));
  });

  it('refuses a conflicting migration on repeated opens', () => {
    openDatabase().exec('DROP TABLE IF EXISTS goods_cost_entries; PRAGMA user_version = 2');
    const accountId = insertAccount('v2');
    run('INSERT INTO console_tokens VALUES (?, ?, ?, ?, NULL)', 'token', accountId, NOW, NOW);
    openDatabase().exec('CREATE TABLE goods_cost_entries (sentinel TEXT)');
    closeDatabase();
    assert.throws(() => openDatabase(dbPath), { code: 'E_AUTH_STATE_IO' });
    assert.throws(() => openDatabase(dbPath));
  });

  it('upgrades a v2 database preserving its console and account rows', () => {
    openDatabase().exec('DROP TABLE IF EXISTS goods_cost_entries; PRAGMA user_version = 2');
    const accountId = insertAccount('v2-preserved');
    run('INSERT INTO console_tokens VALUES (?, ?, ?, ?, NULL)', 'retained-token', accountId, NOW, NOW);
    closeDatabase();
    openDatabase(dbPath);
    assert.equal(get('PRAGMA user_version').user_version, 3);
    assert.equal(get('SELECT account_id FROM console_tokens').account_id, accountId);
    assert.ok(get("SELECT name FROM sqlite_master WHERE name = 'goods_cost_entries'"));
  });

  it('cascades goods costs for every mall and spec while retaining another account', () => {
    const removed = insertAccount('cost-removed');
    const retained = insertAccount('cost-retained');
    for (const accountId of [removed, retained]) {
      for (const mallId of ['900001', '900002']) {
        for (const spec of ['', 'red']) {
          run(`INSERT INTO goods_cost_entries VALUES (?, ?, '101', ?, 100, 0, 0, 0, 0, ?)`, accountId, mallId, spec, NOW);
        }
      }
    }
    run('DELETE FROM accounts WHERE id = ?', removed);
    assert.equal(get('SELECT count(*) AS count FROM goods_cost_entries WHERE account_id = ?', removed).count, 0);
    assert.equal(get('SELECT count(*) AS count FROM goods_cost_entries WHERE account_id = ?', retained).count, 4);
  });

  it('rolls back all writes when a transaction callback throws', () => {
    const failure = new Error('synthetic transaction failure');
    assert.throws(() => transaction(() => {
      assert.equal(isInTransaction(), true);
      run('INSERT INTO meta (key, value) VALUES (?, ?)', 'rolled-back', 'value');
      throw failure;
    }), (error) => error === failure);

    assert.equal(get('SELECT value FROM meta WHERE key = ?', 'rolled-back'), undefined);
    assert.equal(isInTransaction(), false);
    assert.equal(transaction(() => {
      run('INSERT INTO meta (key, value) VALUES (?, ?)', 'committed', 'value');
      return 'result';
    }), 'result');
    assert.equal(get('SELECT value FROM meta WHERE key = ?', 'committed').value, 'value');
  });

  it.each(['resolved', 'rejected'])('rejects a %s Promise callback, rolls back, and handles rejection', async (state) => {
    const unhandled = [];
    const onUnhandled = (error) => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    try {
      assert.throws(() => transaction(() => {
        run('INSERT INTO meta (key, value) VALUES (?, ?)', 'async-write', 'value');
        return state === 'resolved' ? Promise.resolve('value') : Promise.reject(new Error('synthetic rejection'));
      }), { code: 'E_GENERAL' });
      assert.equal(get('SELECT value FROM meta WHERE key = ?', 'async-write'), undefined);
      assert.equal(isInTransaction(), false);
      await nextTurn();
      await nextTurn();
      assert.deepEqual(unhandled, []);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  it('cascades account deletion to all six dependent tables without deleting another account', () => {
    const removed = insertAccount('removed');
    const retained = insertAccount('retained');
    for (const accountId of [removed, retained]) {
      run('INSERT INTO auth_states (account_id, revision, state_sealed, updated_at) VALUES (?, ?, ?, ?)', accountId, 1, 'synthetic sealed state', NOW);
      run('INSERT INTO credentials (account_id, password_sealed, updated_at) VALUES (?, ?, ?)', accountId, 'synthetic sealed password', NOW);
      run('INSERT INTO relogin_states (account_id, status, updated_at) VALUES (?, ?, ?)', accountId, 'available', NOW);
      insertPending(accountId, 'human_verification');
      run('INSERT INTO console_tokens(token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)', `token-${accountId}`, accountId, NOW, NOW);
      run('INSERT INTO console_sessions(session_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)', `session-${accountId}`, accountId, NOW, NOW);
    }

    assert.equal(run('DELETE FROM accounts WHERE id = ?', removed).changes, 1);
    assert.equal(get('SELECT id FROM accounts WHERE id = ?', removed), undefined);
    assert.equal(get('SELECT id FROM accounts WHERE id = ?', retained).id, retained);
    for (const table of ['auth_states', 'credentials', 'relogin_states', 'pending_actions', 'console_tokens', 'console_sessions']) {
      assert.equal(get(`SELECT count(*) AS count FROM ${table} WHERE account_id = ?`, removed).count, 0, table);
      assert.equal(get(`SELECT count(*) AS count FROM ${table} WHERE account_id = ?`, retained).count, 1, table);
    }
  });

  it('allows one default per account kind and multiple non-default accounts', () => {
    insertAccount('merchant-default', { isDefault: 1 });
    const other = insertAccount('merchant-other');
    insertAccount('merchant-third');
    insertAccount('consumer-default', { kind: 'consumer', isDefault: 1 });

    assert.throws(() => insertAccount('duplicate-default', { isDefault: 1 }), /UNIQUE constraint failed: accounts.kind/);
    assert.throws(() => run('UPDATE accounts SET is_default = 1 WHERE id = ?', other), /UNIQUE constraint failed: accounts.kind/);
    assert.equal(get('SELECT count(*) AS count FROM accounts').count, 4);
    assert.equal(all("PRAGMA index_list('accounts')").find((index) => index.name === 'accounts_one_default').partial, 1);
  });

  it('allows one open pending action per account and kind while retaining resolved history', () => {
    const first = insertAccount('first');
    const second = insertAccount('second');
    insertPending(first, 'human_verification');
    assert.throws(() => insertPending(first, 'human_verification'), /UNIQUE constraint failed: pending_actions.account_id, pending_actions.kind/);
    insertPending(first, 'human_verification', 'resolved');
    insertPending(first, 'human_verification', 'resolved');
    insertPending(first, 'other_action');
    insertPending(second, 'human_verification');
    run("UPDATE pending_actions SET status = 'resolved' WHERE account_id = ? AND kind = ?", first, 'human_verification');
    insertPending(first, 'human_verification');

    assert.equal(get('SELECT count(*) AS count FROM pending_actions').count, 6);
    assert.equal(all("PRAGMA index_list('pending_actions')").find((index) => index.name === 'pending_actions_one_open').partial, 1);
  });
});
