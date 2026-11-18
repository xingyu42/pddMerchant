import assert from 'node:assert/strict';
import { it } from 'vitest';
import { usePasswordReloginSandbox } from '../helpers/password-relogin-cli.js';
import { loadAuthState } from '../../src/adapter/auth-state.js';

// 密码自动重登：恢复主流程、并发复用、独立预算。其余主题见 password-relogin-*.e2e.test.js。
const { seed, state, attempts, cli, startCli } = usePasswordReloginSandbox();

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
