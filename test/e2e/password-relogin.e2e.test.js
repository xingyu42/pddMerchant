import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, it } from 'vitest';
import { createCliSandbox } from '../helpers/isolated-cli.js';
import { seedDb, DEFAULT_ACCOUNT } from '../helpers/seed-db.js';
import { assertEnvelopeShape } from '../helpers/envelope-assertions.js';
import { closeDatabase, getDatabasePath, openDatabase } from '../../src/infra/db.js';
import { getReloginState, listPendingActions, insertPendingAction } from '../../src/infra/account-store.js';
import { loadAuthState, saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { setAccountPassword, clearReloginBlock } from '../../src/services/password-relogin.js';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const cliPath = join(projectRoot, 'bin/pdd.js');
const preloadUrl = new URL('../helpers/offline-preload.js', import.meta.url).href;
const credential = { loginName: 'synthetic-login-p3-52482', password: 'synthetic-password-p3-734942' };
const secondAccount = { slug: 'second-shop', display_name: 'Second Shop', identity: '900002' };
let sandbox;
let previousDatabase;

beforeEach(() => {
  previousDatabase = getDatabasePath();
  sandbox = createCliSandbox();
  Object.assign(sandbox.env, { PDD_TEST_AUTH_INVALID: '1', PDD_TEST_PASSWORD_LOGIN_TRACE: join(sandbox.root, 'attempts.log') });
});

afterEach(() => {
  closeDatabase();
  sandbox.dispose();
  openDatabase(previousDatabase);
});

function seed({ accounts = [DEFAULT_ACCOUNT], password = true } = {}) {
  seedDb(sandbox.env.PDD_DB_PATH, {
    accounts,
    authStates: accounts.map((account) => ({ slug: account.slug, state: { cookies: [], origins: [] } })),
    passwordCredentials: password ? accounts.map((account) => ({ slug: account.slug, ...credential })) : [],
  });
}

function database() { openDatabase(sandbox.env.PDD_DB_PATH); }
function openActions(accountId = 1) { database(); return listPendingActions(accountId).filter((action) => action.status === 'open'); }
function state(accountId = 1) { database(); return getReloginState(accountId); }
function attempts() {
  const path = sandbox.env.PDD_TEST_PASSWORD_LOGIN_TRACE;
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean) : [];
}

function parseResult(result) {
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim().split(/\r?\n/).length, 1);
  const envelope = JSON.parse(result.stdout);
  assertEnvelopeShape(envelope, { exitCode: result.status });
  return { ...result, envelope };
}

function cli(args = ['shops', 'current'], env = {}) {
  return parseResult(spawnSync(process.execPath, ['--import', preloadUrl, cliPath, ...args, '--json'], {
    cwd: sandbox.root, env: { ...sandbox.env, ...env }, encoding: 'utf8', timeout: 30000, windowsHide: true,
  }));
}

function startCli(args = ['shops', 'current'], env = {}) {
  const child = spawn(process.execPath, ['--import', preloadUrl, cliPath, ...args, '--json'], {
    cwd: sandbox.root, env: { ...sandbox.env, ...env }, windowsHide: true,
  });
  const result = new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (status, signal) => {
      try { resolve(parseResult({ stdout, stderr, status, signal })); }
      catch (error) { reject(error); }
    });
  });
  return { child, result };
}

function actionWarnings(result) {
  return result.envelope.meta.warnings.filter((warning) => warning.code === 'account_action_required');
}

it('recovers expired auth with a password, saves verified state and continues the command with one JSON line', () => {
  seed();
  const result = cli();
  assert.equal(result.status, 0);
  assert.equal(result.envelope.command, 'shops.current');
  assert.deepEqual(attempts(), ['success']);
  assert.equal(state().reason, 'success');
  const saved = loadAuthState(1);
  assert.equal(saved.revision, 2);
  assert.ok(saved.state.cookies.some((cookie) => cookie.name === 'PDD_FIXTURE_RELOGIN'));
  assert.equal(saved.state.merchant_auth.check_verdict, 'verified');
  assert.equal(cli().status, 0);
  assert.deepEqual(attempts(), ['success']);
});

it('preserves the login fallback without a saved password', () => {
  seed({ password: false });
  const result = cli();
  assert.equal(result.status, 3);
  assert.equal(result.envelope.error.code, 'E_AUTH_EXPIRED');
  assert.match(result.envelope.error.hint, /pdd login/);
  assert.deepEqual(attempts(), []);
});

it.each(['sms', 'slider', 'click', 'risk_confirm', 'unknown'])('stops on %s, persists one human action and warns on the failing command', (challenge) => {
  seed();
  const result = cli(undefined, { PDD_TEST_PASSWORD_LOGIN: `challenge:${challenge}` });
  assert.equal(result.status, 3);
  assert.equal(result.envelope.error.code, 'E_AUTH_HUMAN_REQUIRED');
  assert.match(result.envelope.error.hint, /pdd console link/);
  assert.equal(state().status, 'awaiting_human');
  assert.deepEqual(openActions().map((action) => [action.kind, action.reason]), [['human_takeover', challenge]]);
  assert.deepEqual(actionWarnings(result), [{ code: 'account_action_required', account: DEFAULT_ACCOUNT.slug, reason: challenge }]);
  assert.equal(cli().envelope.error.code, 'E_AUTH_HUMAN_REQUIRED');
  assert.deepEqual(attempts(), [`challenge:${challenge}`]);
  assert.equal(openActions().length, 1);
});

it.each(['wrong_password', 'account_locked'])('blocks %s and skips every subsequent attempt', (reason) => {
  seed();
  const first = cli(undefined, { PDD_TEST_PASSWORD_LOGIN: reason });
  assert.equal(first.status, 3);
  assert.equal(first.envelope.error.code, 'E_AUTH_RELOGIN_BLOCKED');
  assert.equal(state().status, 'blocked');
  assert.deepEqual(openActions().map((action) => [action.kind, action.reason]), [['relogin_blocked', reason]]);
  assert.equal(cli().envelope.error.code, 'E_AUTH_RELOGIN_BLOCKED');
  assert.deepEqual(attempts(), [reason]);
});

it.each(['password_reset', 'manual_unblock'])('allows recovery after %s and resolves block actions', (method) => {
  seed();
  cli(undefined, { PDD_TEST_PASSWORD_LOGIN: 'wrong_password' });
  database();
  if (method === 'password_reset') setAccountPassword(1, credential);
  else clearReloginBlock(1);
  assert.equal(state().reason, method);
  assert.deepEqual(openActions(), []);
  assert.equal(cli().status, 0);
  assert.deepEqual(attempts(), ['wrong_password', 'success']);
});

it.each([false, true])('manual login clears awaiting-human state and its action (explicit account: %s)', (explicit) => {
  seed();
  cli(undefined, { PDD_TEST_PASSWORD_LOGIN: 'challenge:sms' });
  const args = ['login', '--qr', ...(explicit ? ['--account', DEFAULT_ACCOUNT.slug] : [])];
  assert.equal(cli(args, { PDD_TEST_AUTH_INVALID: '0' }).status, 0);
  assert.equal(state().status, 'available');
  assert.equal(state().reason, 'manual_login');
  assert.deepEqual(openActions(), []);
  assert.deepEqual(attempts(), ['challenge:sms']);
});

it.each(['wrong_password', 'account_locked', 'takeover_timeout'])('manual login preserves the %s block and its pending action', (reason) => {
  seed();
  if (reason === 'takeover_timeout') {
    seedDb(sandbox.env.PDD_DB_PATH, { reloginStates: [{ accountId: 1, status: 'blocked', reason, consecutiveTakeoverTimeouts: 2 }] });
    database();
    insertPendingAction(1, { kind: 'relogin_blocked', reason });
  } else cli(undefined, { PDD_TEST_PASSWORD_LOGIN: reason });
  const before = state();
  assert.equal(cli(['login', '--qr'], { PDD_TEST_AUTH_INVALID: '0' }).status, 0);
  assert.deepEqual(state(), before);
  assert.equal(openActions()[0].kind, 'relogin_blocked');
});

it('new manual login creates no relogin state', () => {
  seed({ accounts: [] });
  assert.equal(cli(['login', '--qr'], { PDD_TEST_AUTH_INVALID: '0' }).status, 0);
  assert.equal(state(), null);
});

it.each([['network_error', 'E_AUTH_RELOGIN_FAILED'], ['form_changed', 'E_PASSWORD_LOGIN_FORM_CHANGED'], ['success', 'E_AUTH_EXPIRED']])(
  'throttles a second invalidation after %s and restores the previous error category', (outcome, code) => {
    seed();
    cli(undefined, { PDD_TEST_PASSWORD_LOGIN: outcome });
    if (outcome === 'success') { database(); saveAuthStateSnapshot({ cookies: [], origins: [] }, 1); }
    const result = cli();
    assert.equal(result.status, 3);
    assert.equal(result.envelope.error.code, code);
    assert.equal(result.envelope.error.detail.relogin, 'throttled');
    assert.match(result.envelope.error.detail.next_attempt_at, /^\d{4}-\d{2}-\d{2} /);
    assert.deepEqual(attempts(), [outcome]);
  },
);

it('two concurrent processes wait past the normal lease budget and reuse one login', async () => {
  seed();
  const first = startCli(undefined, { PDD_TEST_PASSWORD_LOGIN_DELAY_MS: '16000', PDD_TIMEOUT_MS: '25000' });
  for (let i = 0; i < 500 && attempts().length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  const second = startCli(undefined, { PDD_TIMEOUT_MS: '25000' });
  const timer = setTimeout(() => { first.child.kill(); second.child.kill(); }, 30000);
  try {
    assert.deepEqual(attempts(), ['success']);
    const results = await Promise.all([first.result, second.result]);
    assert.deepEqual(results.map((result) => result.status), [0, 0]);
    assert.deepEqual(attempts(), ['success']);
  } finally {
    clearTimeout(timer);
    first.child.kill(); second.child.kill();
  }
});

it('password login has an independent budget even with a short ordinary command timeout', () => {
  seed();
  const result = cli(['shops', 'current', '--timeout', '300'], { PDD_TEST_PASSWORD_LOGIN_DELAY_MS: '800' });
  assert.equal(result.status, 0);
  assert.deepEqual(attempts(), ['success']);
});

it('does not attempt login on an indeterminate check', () => {
  seed();
  assert.equal(cli(undefined, { PDD_TEST_AUTH_INDETERMINATE: '1' }).envelope.error.code, 'E_AUTH_CHECK_INDETERMINATE');
  assert.deepEqual(attempts(), []);
  assert.equal(state(), null);
});

it('warnings cover only the merchant account actually used, including successful commands', () => {
  seed({ accounts: [DEFAULT_ACCOUNT, secondAccount] });
  database();
  insertPendingAction(2, { kind: 'human_takeover', reason: 'slider' });
  const own = cli(undefined, { PDD_TEST_AUTH_INVALID: '0' });
  assert.equal(own.status, 0);
  assert.deepEqual(actionWarnings(own), []);
  const other = cli(['shops', 'current', '--account', secondAccount.slug], { PDD_TEST_AUTH_INVALID: '0' });
  assert.equal(other.status, 0);
  assert.deepEqual(actionWarnings(other), [{ code: 'account_action_required', account: secondAccount.slug, reason: 'slider' }]);
  for (const args of [['doctor'], ['account', 'list']]) assert.deepEqual(actionWarnings(cli(args)), []);
  assert.deepEqual(attempts(), []);
});

it('doctor reports invalid auth without triggering password login', () => {
  seed();
  const result = cli(['doctor']);
  assert.equal(result.status, 3);
  assert.deepEqual(actionWarnings(result), []);
  assert.deepEqual(attempts(), []);
  assert.equal(state(), null);
});

it('all-accounts recovers in order and aggregates each used account action warning', () => {
  const accounts = [DEFAULT_ACCOUNT, secondAccount];
  seed({ accounts });
  const result = cli(['shops', 'current', '--all-accounts'], { PDD_TEST_PASSWORD_LOGIN_DELAY_MS: '100' });
  assert.equal(result.status, 0);
  assert.deepEqual(Object.keys(result.envelope.data.accounts), accounts.map((account) => account.slug));
  assert.deepEqual(attempts(), ['success', 'success']);
  assert.ok(Date.parse(state(2).last_attempt_at) - Date.parse(state(1).last_attempt_at) >= 100);
  database();
  for (const id of [1, 2]) insertPendingAction(id, { kind: 'human_takeover', reason: 'sms' });
  const warned = cli(['shops', 'current', '--all-accounts']);
  assert.equal(warned.status, 0);
  assert.deepEqual(actionWarnings(warned), accounts.map((account) => ({ code: 'account_action_required', account: account.slug, reason: 'sms' })));
});

it('debug output, appended runtime logs and database bytes contain neither password nor login name', () => {
  seed();
  const logDir = join(projectRoot, 'log/cli');
  const offsets = new Map(existsSync(logDir) ? readdirSync(logDir).map((name) => [name, statSync(join(logDir, name)).size]) : []);
  const result = cli(undefined, { PDD_DEBUG_RAW: '1', PDD_LOG_LEVEL: 'debug', PDD_TEST_PASSWORD_LOGIN: 'wrong_password' });
  assert.equal(result.status, 3);
  const buffers = [Buffer.from(result.stdout + result.stderr)];
  for (const name of readdirSync(sandbox.root).filter((name) => /^pdd\.db(?:-wal|-shm)?$/.test(name))) {
    buffers.push(readFileSync(join(sandbox.root, name)));
  }
  if (existsSync(logDir)) for (const name of readdirSync(logDir)) {
    buffers.push(readFileSync(join(logDir, name)).subarray(offsets.get(name) ?? 0));
  }
  for (const buffer of buffers) for (const secret of Object.values(credential)) {
    assert.equal(buffer.includes(Buffer.from(secret)), false, 'credential plaintext must remain private');
  }
});
