import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { runCli } from '../helpers/isolated-cli.js';

describe('merchant authentication CLI contract', () => {
  for (const args of [['login', '--qr'], ['init', '--qr'], ['account', 'add']]) {
    it(`keeps ${args.join(' ')} to one JSON line without exporting credentials`, () => {
      const result = runCli(args);
      assert.equal(result.status, 0);
      assert.equal(result.envelope.ok, true);
      assert.equal(result.envelope.data.mall_id, '900001');
      assert.ok(result.envelope.data.headline.length > 0);
      assert.ok(!result.stdout.includes('PASS_ID'));
      assert.ok(!result.stdout.includes('qr_pending'));
      assert.ok(!result.stdout.includes('auth-state.json'));
      assert.ok(!result.stdout.includes('daemon'));
    });
  }

  it('maps unconfirmed network checks to exit 5, not expired credentials', () => {
    const result = runCli(['orders', 'list'], { authIndeterminate: true });
    assert.equal(result.status, 5);
    assert.equal(result.envelope.error.code, 'E_AUTH_CHECK_INDETERMINATE');
  });

  it('maps explicit login rejection to auth exit 3', () => {
    const result = runCli(['login', '--qr'], { authInvalid: true });
    assert.equal(result.status, 3);
    assert.equal(result.envelope.error.code, 'E_AUTH_EXPIRED');
  });

  it('does not report a QR login success on an indeterminate check', () => {
    const result = runCli(['login', '--qr'], { authIndeterminate: true });
    assert.equal(result.status, 5);
    assert.equal(result.envelope.ok, false);
  });

  it('doctor distinguishes verified and indeterminate states without exposing cookies', () => {
    const authState = { cookies: [{ name: 'PASS_ID', value: 'synthetic-secret' }], origins: [] };
    const valid = runCli(['doctor'], { authState });
    assert.equal(valid.status, 0);
    assert.equal(valid.envelope.data.logged_in.detail.verdict, '已验证');
    assert.equal(valid.envelope.data.auth_file.detail.cookie_count, 1);
    assert.ok(!valid.stdout.includes('synthetic-secret'));
    assert.ok(!Object.hasOwn(valid.envelope.data, 'daemon'));
    const uncertain = runCli(['doctor'], { authState, authIndeterminate: true });
    assert.equal(uncertain.status, 5);
    assert.equal(uncertain.envelope.error.code, 'E_AUTH_CHECK_INDETERMINATE');
    assert.equal(uncertain.envelope.error.detail.logged_in.detail.verdict, 'indeterminate');
  });

  it('rejects the removed daemon command without starting a process', () => {
    const result = runCli(['daemon', 'start']);
    assert.equal(result.status, 2);
    assert.equal(result.envelope.error.code, 'E_USAGE');
    assert.equal(result.envelope.error.detail.commander_code, 'commander.unknownCommand');
  });

  it('does not expose background scheduling configuration', () => {
    const result = runCli(['config', 'show']);
    assert.equal(result.status, 0);
    assert.ok(!Object.hasOwn(result.envelope.data.fields, 'refreshIntervalMs'));
    assert.ok(!Object.hasOwn(result.envelope.data.fields, 'refreshJitterMs'));
  });
});
