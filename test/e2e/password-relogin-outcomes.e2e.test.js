import assert from 'node:assert/strict';
import { it } from 'vitest';
import { actionWarnings, credential, usePasswordReloginSandbox } from '../helpers/password-relogin-cli.js';
import { DEFAULT_ACCOUNT } from '../helpers/seed-db.js';
import { saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { setAccountPassword, clearReloginBlock } from '../../src/services/relogin-policy.js';

// 密码自动重登的失败结果：人工挑战、熔断、解除熔断、节流。
const { seed, database, openActions, state, attempts, cli } = usePasswordReloginSandbox();

it.each(['sms', 'slider', 'click', 'risk_confirm', 'unknown'])('stops on %s, persists one human action and warns on the failing command', (challenge) => {
  seed();
  const result = cli(undefined, { PDD_TEST_PASSWORD_LOGIN: `challenge:${challenge}` });
  assert.equal(result.status, 3);
  assert.equal(result.envelope.error.code, 'E_AUTH_HUMAN_REQUIRED');
  assert.match(result.envelope.error.hint, /pdd console link/);
  assert.equal(state().status, 'awaiting_human');
  assert.deepEqual(openActions().map((action) => [action.kind, action.reason]), [['human_takeover', challenge]]);
  assert.deepEqual(actionWarnings(result), [{ code: 'account_action_required', account: DEFAULT_ACCOUNT.slug, reason: challenge }]);
  assert.deepEqual(result.envelope.meta.warnings.filter((warning) => warning.code === 'daemon_not_running'), [{ code: 'daemon_not_running' }]);
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
