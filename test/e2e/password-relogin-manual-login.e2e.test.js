import assert from 'node:assert/strict';
import { it } from 'vitest';
import { usePasswordReloginSandbox } from '../helpers/password-relogin-cli.js';
import { seedDb, DEFAULT_ACCOUNT } from '../helpers/seed-db.js';
import { insertPendingAction } from '../../src/infra/account-store.js';

// 手动登录与密码自动重登状态的相互作用。
const { sandbox, seed, database, openActions, state, attempts, cli } = usePasswordReloginSandbox();

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

it.each(['wrong_password', 'account_locked', 'takeover_timeout'])('manual login preserves the %s block/action and resets consecutive timeouts', (reason) => {
  seed();
  if (reason === 'takeover_timeout') {
    seedDb(sandbox().env.PDD_DB_PATH, { reloginStates: [{ accountId: 1, status: 'blocked', reason, consecutiveTakeoverTimeouts: 2 }] });
    database();
    insertPendingAction(1, { kind: 'relogin_blocked', reason });
  } else cli(undefined, { PDD_TEST_PASSWORD_LOGIN: reason });
  const before = state();
  assert.equal(cli(['login', '--qr'], { PDD_TEST_AUTH_INVALID: '0' }).status, 0);
  const after = state();
  assert.equal(after.status, before.status);
  assert.equal(after.reason, before.reason);
  assert.equal(after.last_attempt_at, before.last_attempt_at);
  assert.equal(after.consecutive_takeover_timeouts, 0);
  assert.equal(openActions()[0].kind, 'relogin_blocked');
});

it('new manual login creates no relogin state', () => {
  seed({ accounts: [] });
  assert.equal(cli(['login', '--qr'], { PDD_TEST_AUTH_INVALID: '0' }).status, 0);
  assert.equal(state(), null);
});
