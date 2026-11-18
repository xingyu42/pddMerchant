import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import {
  actionWarnings, credential, projectRoot, secondAccount, usePasswordReloginSandbox,
} from '../helpers/password-relogin-cli.js';
import { seedDb, DEFAULT_ACCOUNT } from '../helpers/seed-db.js';
import { insertPendingAction } from '../../src/infra/account-store.js';

// 密码自动重登的对外呈现：告警范围、doctor / account list 报告、多账号聚合、凭据保密。
const { sandbox, seed, database, openActions, state, attempts, cli } = usePasswordReloginSandbox();

it('warnings cover only the merchant account actually used, including successful commands', () => {
  seed({ accounts: [DEFAULT_ACCOUNT, secondAccount] });
  database();
  insertPendingAction(2, { kind: 'human_takeover', reason: 'slider' });
  const own = cli(undefined, { PDD_TEST_AUTH_INVALID: '0' });
  assert.equal(own.status, 0);
  assert.deepEqual(actionWarnings(own), []);
  assert.equal(own.envelope.meta.warnings.some((warning) => warning.code === 'daemon_not_running'), false);
  const other = cli(['shops', 'current', '--account', secondAccount.slug], { PDD_TEST_AUTH_INVALID: '0' });
  assert.equal(other.status, 0);
  assert.deepEqual(actionWarnings(other), [{ code: 'account_action_required', account: secondAccount.slug, reason: 'slider' }]);
  assert.deepEqual(other.envelope.meta.warnings.filter((warning) => warning.code === 'daemon_not_running'), [{ code: 'daemon_not_running' }]);
  for (const args of [['doctor'], ['account', 'list']]) assert.deepEqual(actionWarnings(cli(args)), []);
  assert.deepEqual(attempts(), []);
});

it('doctor reports invalid auth without triggering password login', () => {
  seed();
  const result = cli(['doctor']);
  assert.equal(result.status, 3);
  assert.deepEqual(result.envelope.error.detail.password_relogin, { has_password: true, status: '可用' });
  assert.deepEqual(actionWarnings(result), []);
  assert.deepEqual(attempts(), []);
  assert.equal(state(), null);
});

it.each([
  ['blocked', 'wrong_password', '已熔断：密码错误'],
  ['awaiting_human', 'sms', '等待人工：短信验证'],
])('account list and doctor report seeded %s state without login or action warnings', (status, reason, label) => {
  seed();
  seedDb(sandbox().env.PDD_DB_PATH, { reloginStates: [{ accountId: 1, status, reason }] });
  database();
  insertPendingAction(1, { kind: status === 'blocked' ? 'relogin_blocked' : 'human_takeover', reason });
  const before = state();
  const listed = cli(['account', 'list']);
  assert.equal(listed.status, 0);
  assert.equal(listed.envelope.data.items[0].has_password, true);
  assert.equal(listed.envelope.data.items[0].password_relogin_status, label);
  const doctor = cli(['doctor'], { PDD_TEST_AUTH_INVALID: '0' });
  assert.equal(doctor.status, 0);
  assert.deepEqual(doctor.envelope.data.password_relogin, { has_password: true, status: label });
  assert.equal(doctor.envelope.data.accounts[0].has_password, true);
  assert.equal(doctor.envelope.data.accounts[0].password_relogin_status, label);
  for (const result of [listed, doctor]) {
    assert.deepEqual(actionWarnings(result), []);
    for (const secret of [...Object.values(credential), 'login_name']) assert.equal(result.stdout.includes(secret), false);
  }
  assert.deepEqual(attempts(), []);
  assert.deepEqual(state(), before);
  assert.equal(openActions().length, 1);
});

it('doctor reports no password when no current merchant account exists', () => {
  seed({ accounts: [] });
  const result = cli(['doctor']);
  assert.equal(result.status, 3);
  assert.equal(result.envelope.error.code, 'E_AUTH_STATE_MISSING');
  assert.deepEqual(result.envelope.error.detail.password_relogin, { has_password: false, status: null });
  assert.deepEqual(actionWarnings(result), []);
  assert.deepEqual(attempts(), []);
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
  assert.deepEqual(warned.envelope.meta.warnings.filter((warning) => warning.code === 'daemon_not_running'), [{ code: 'daemon_not_running' }]);
});

it('debug output, appended runtime logs and database bytes contain neither password nor login name', () => {
  seed();
  const logDir = join(projectRoot, 'log/cli');
  const offsets = new Map(existsSync(logDir) ? readdirSync(logDir).map((name) => [name, statSync(join(logDir, name)).size]) : []);
  const result = cli(undefined, { PDD_DEBUG_RAW: '1', PDD_LOG_LEVEL: 'debug', PDD_TEST_PASSWORD_LOGIN: 'wrong_password' });
  assert.equal(result.status, 3);
  const buffers = [Buffer.from(result.stdout + result.stderr)];
  for (const name of readdirSync(sandbox().root).filter((name) => /^pdd\.db(?:-wal|-shm)?$/.test(name))) {
    buffers.push(readFileSync(join(sandbox().root, name)));
  }
  if (existsSync(logDir)) for (const name of readdirSync(logDir)) {
    buffers.push(readFileSync(join(logDir, name)).subarray(offsets.get(name) ?? 0));
  }
  for (const buffer of buffers) for (const secret of Object.values(credential)) {
    assert.equal(buffer.includes(Buffer.from(secret)), false, 'credential plaintext must remain private');
  }
});
