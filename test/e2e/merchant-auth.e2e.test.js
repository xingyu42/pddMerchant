import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { createCliSandbox, runCli, spawnNode } from '../helpers/isolated-cli.js';

describe('merchant authentication CLI contract', () => {
  it('keeps login --qr to one JSON line without exporting credentials', () => {
    const result = runCli(['login', '--qr'], { accounts: [] });
    assert.equal(result.status, 0);
    assert.equal(result.envelope.ok, true);
    assert.equal(result.envelope.data.mall_id, '900001');
    assert.ok(result.envelope.data.account_slug ?? result.envelope.data.slug);
    assert.ok(result.envelope.data.headline.length > 0);
    assert.ok(!result.stdout.includes('PASS_ID'));
    assert.ok(!result.stdout.includes('qr_pending'));
    assert.ok(!result.stdout.includes('auth-state.json'));
    assert.ok(!Object.hasOwn(result.envelope.data, 'daemon'));
  });

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

  it('exposes daemon status without implicitly starting a process', () => {
    const result = runCli(['daemon', 'status']);
    assert.equal(result.status, 0);
    assert.equal(result.envelope.data.running, false);
    assert.equal(result.envelope.data.pid, null);
  });

  it('does not expose background scheduling configuration', () => {
    const result = runCli(['config', 'show']);
    assert.equal(result.status, 0);
    assert.ok(!Object.hasOwn(result.envelope.data.fields, 'refreshIntervalMs'));
    assert.ok(!Object.hasOwn(result.envelope.data.fields, 'refreshJitterMs'));
  });

  it('emits v2 envelopes with correlation_id and latency_ms for login and login.consumer', () => {
    for (const [args, expectedCommand, expectedMode] of [
      [['login', '--qr'], 'login', '扫码登录'],
      [['login', '--consumer', '--qr'], 'login.consumer', '扫码登录'],
      [['login', '--consumer', '--headed'], 'login.consumer', '有头浏览器登录'],
    ]) {
      const result = runCli(args, { accounts: [] });
      assert.equal(result.status, 0);
      assert.equal(result.envelope.ok, true);
      assert.equal(result.envelope.command, expectedCommand);
      assert.equal(result.envelope.meta.v, 2);
      assert.equal(typeof result.envelope.meta.correlation_id, 'string');
      assert.ok(result.envelope.meta.correlation_id.length > 0);
      assert.equal(typeof result.envelope.meta.latency_ms, 'number');
      assert.equal(result.envelope.data.mode, expectedMode);
      assert.equal(result.stdout.trim().split(/\r?\n/).length, 1);
    }

    const unknownPassword = runCli(['login', '--consumer', '--password', 'secret']);
    assert.equal(unknownPassword.status, 2);
    assert.equal(unknownPassword.envelope.error.code, 'E_USAGE');

    for (const args of [
      ['login', '--all-accounts'],
      ['login', '--consumer', '--all-accounts'],
      ['account', 'list', '--all-accounts'],
    ]) {
      const batchReject = runCli(args);
      assert.equal(batchReject.status, 2);
      assert.equal(batchReject.envelope.error.code, 'E_USAGE');
      assert.ok(batchReject.envelope.meta.correlation_id);
    }
  });

  it('emits v2 envelopes with correlation_id and latency_ms across account.* commands', () => {
    const accounts = [
      { slug: 'shop-a', display_name: 'Shop A', identity: '900001', is_default: 1 },
      { slug: 'shop-b', display_name: 'Shop B', identity: '900002', is_default: 0 },
    ];
    for (const [args, expectedCommand] of [
      [['account', 'list'], 'account.list'],
      [['account', 'default', '--slug', 'shop-b'], 'account.default'],
      [['account', 'remove', '--slug', 'shop-b'], 'account.remove'],
    ]) {
      const res = runCli(args, { accounts });
      assert.equal(res.status, 0);
      assert.equal(res.envelope.ok, true);
      assert.equal(res.envelope.command, expectedCommand);
      assert.equal(res.envelope.meta.v, 2);
      assert.ok(res.envelope.meta.correlation_id);
      assert.equal(typeof res.envelope.meta.latency_ms, 'number');
      assert.equal(res.stdout.trim().split(/\r?\n/).length, 1);
    }
  });

  it('honors --no-color on non-JSON login output', async () => {
    const sandbox = createCliSandbox({ accounts: [] });
    try {
      const cliPath = fileURLToPath(new URL('../../bin/pdd.js', import.meta.url));
      const { NO_COLOR: _ignored, ...envWithoutNoColor } = sandbox.env;
      const result = await spawnNode([cliPath, 'login', '--qr', '--no-color'], { env: envWithoutNoColor });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(/\u001b\[/.test(result.stdout), false);
      assert.match(result.stdout, /login/);
    } finally {
      sandbox.dispose();
    }
  });
});
