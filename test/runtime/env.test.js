import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { parseRuntimeEnv } from '../../src/runtime/env.js';

describe('parseRuntimeEnv whitelist parser', () => {
  it('defaults to live mode and resolves fixture mode from PDD_TEST_ADAPTER', () => {
    assert.equal(parseRuntimeEnv({}).mode, 'live');
    assert.equal(parseRuntimeEnv({ PDD_TEST_ADAPTER: '' }).mode, 'live');
    assert.equal(parseRuntimeEnv({ PDD_TEST_ADAPTER: 'fixture' }).mode, 'fixture');
    assert.equal(parseRuntimeEnv({ PDD_TEST_ADAPTER: 'fixture' }, { mode: 'live' }).mode, 'live');
    assert.equal(parseRuntimeEnv({}, { mode: 'fixture' }).mode, 'fixture');
    assert.throws(() => parseRuntimeEnv({}, { mode: 'staging' }), { code: 'E_CONFIG_INVALID' });
  });

  it('freezes parsed env snapshots and nested slices', () => {
    const parsed = parseRuntimeEnv({
      PDD_TEST_ADAPTER: 'fixture',
      PDD_SOURCE_PROXY_PROVIDER: 'qingguo',
      PDD_QINGGUO_AUTH_KEY: 'key',
    });
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.sourceProxyEnv), true);
    assert.equal(Object.isFrozen(parsed.testEnv), true);
  });

  it('ignores all PDD_TEST_* fixture flags and test timings in live mode', () => {
    const parsed = parseRuntimeEnv({
      PDD_TEST_ADAPTER: 'fixture',
      PDD_TEST_FIXTURE_DIR: '/tmp/fixtures',
      PDD_TEST_AUTH_INVALID: '1',
      PDD_TEST_AUTH_INDETERMINATE: '1',
      PDD_TEST_CONSUMER_AUTH_INVALID: '1',
      PDD_TEST_PASSWORD_LOGIN: 'wrong_password',
      PDD_TEST_PASSWORD_LOGIN_DELAY_MS: '500',
      PDD_TEST_PASSWORD_LOGIN_TRACE: '/tmp/trace.log',
      PDD_TEST_DAEMON_LEASE_TTL_MS: '500',
      PDD_TEST_DAEMON_HEARTBEAT_MS: '50',
      PDD_TEST_PATROL_INTERVAL_MS: '100',
      PDD_DEBUG_RAW: '1',
      PDD_SCRAPE_SIMULATE: '0',
      PDD_IMAGE_TRANSFORM: '1',
      PDD_SOURCE_PROXY_PROVIDER: 'qingguo',
      PDD_QINGGUO_AUTH_KEY: 'secret-key',
      PDD_QINGGUO_AREA: '330100',
    }, { mode: 'live' });

    assert.equal(parsed.mode, 'live');
    assert.equal(parsed.fixtureDir, undefined);
    assert.equal(parsed.authInvalid, false);
    assert.equal(parsed.authIndeterminate, false);
    assert.equal(parsed.consumerAuthInvalid, false);
    assert.equal(parsed.passwordLogin, null);
    assert.equal(parsed.passwordLoginDelayMs, 0);
    assert.equal(parsed.passwordLoginTrace, undefined);
    assert.equal(parsed.daemonLeaseTtlMs, null);
    assert.equal(parsed.daemonHeartbeatMs, null);
    assert.equal(parsed.patrolIntervalMs, null);
    assert.equal(parsed.debugRaw, true);
    assert.equal(parsed.scrapeSimulate, false);
    assert.equal(parsed.imageTransform, true);
    assert.deepEqual(parsed.sourceProxyEnv, {
      PDD_SOURCE_PROXY_PROVIDER: 'qingguo',
      PDD_QINGGUO_AUTH_KEY: 'secret-key',
      PDD_QINGGUO_AREA: '330100',
    });
  });

  it('parses fixture flags and rejects non-positive or non-safe-integer timings', () => {
    const valid = parseRuntimeEnv({
      PDD_TEST_ADAPTER: 'fixture',
      PDD_TEST_FIXTURE_DIR: '/tmp/fx',
      PDD_TEST_AUTH_INVALID: '1',
      PDD_TEST_AUTH_INDETERMINATE: '1',
      PDD_TEST_CONSUMER_AUTH_INVALID: '1',
      PDD_TEST_PASSWORD_LOGIN: 'challenge:sms',
      PDD_TEST_PASSWORD_LOGIN_DELAY_MS: '250',
      PDD_TEST_PASSWORD_LOGIN_TRACE: '/tmp/attempts.log',
      PDD_TEST_DAEMON_LEASE_TTL_MS: '500',
      PDD_TEST_DAEMON_HEARTBEAT_MS: '50',
      PDD_TEST_PATROL_INTERVAL_MS: '100',
    });
    assert.equal(valid.fixtureDir, '/tmp/fx');
    assert.equal(valid.authInvalid, true);
    assert.equal(valid.authIndeterminate, true);
    assert.equal(valid.consumerAuthInvalid, true);
    assert.equal(valid.passwordLogin, 'challenge:sms');
    assert.equal(valid.passwordLoginDelayMs, 250);
    assert.equal(valid.passwordLoginTrace, '/tmp/attempts.log');
    assert.equal(valid.daemonLeaseTtlMs, 500);
    assert.equal(valid.daemonHeartbeatMs, 50);
    assert.equal(valid.patrolIntervalMs, 100);
    assert.equal(valid.scrapeSimulate, true);
    assert.equal(valid.imageTransform, false);
    assert.equal(valid.debugRaw, false);

    for (const bad of ['', '0', '-1', '1.5', 'invalid', '9007199254740992']) {
      const invalid = parseRuntimeEnv({
        PDD_TEST_ADAPTER: 'fixture',
        PDD_TEST_DAEMON_LEASE_TTL_MS: bad,
        PDD_TEST_DAEMON_HEARTBEAT_MS: bad,
        PDD_TEST_PATROL_INTERVAL_MS: bad,
      });
      assert.equal(invalid.daemonLeaseTtlMs, null);
      assert.equal(invalid.daemonHeartbeatMs, null);
      assert.equal(invalid.patrolIntervalMs, null);
    }
  });
});
