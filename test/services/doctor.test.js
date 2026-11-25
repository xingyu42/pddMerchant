import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'vitest';
import { saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { insertAccount, getReloginState } from '../../src/infra/account-store.js';
import { get, getDatabasePath, run } from '../../src/infra/db.js';
import { ExitCodes } from '../../src/infra/errors.js';
import { getLogger } from '../../src/infra/logger.js';
import { diagnoseEnvironment } from '../../src/services/doctor.js';
import { setAccountPassword } from '../../src/services/relogin-policy.js';
import { assertDataContractV2 } from '../helpers/data-contract.js';
import { createInMemoryAuthPort, createInMemoryBrowserRuntime } from '../helpers/in-memory-ports.js';

const VALID_STATE = {
  cookies: [{ name: 'PASS_ID', value: 'synthetic-pass', domain: '.pinduoduo.com', path: '/' }],
  origins: [],
};

function createLegacyFile(relativePath = 'merchant/stores/registry.json') {
  const fullPath = join(dirname(getDatabasePath()), relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, '{"legacy":true}');
}

function seedMerchantAndConsumer({ withConsumer = true, withPassword = false } = {}) {
  const merchant = insertAccount({ identity: '900001', displayName: 'Shop A' }, { setDefault: true });
  saveAuthStateSnapshot(VALID_STATE, merchant.id);
  if (withPassword) {
    setAccountPassword(merchant.id, { loginName: 'user-a', password: 'secret-password' });
  }
  let consumer = null;
  if (withConsumer) {
    consumer = insertAccount({ kind: 'consumer', identity: 'uid-1', displayName: 'Buyer A' }, { setDefault: true });
    saveAuthStateSnapshot(VALID_STATE, consumer.id);
  }
  return { merchant, consumer };
}

describe('diagnoseEnvironment domain service', () => {
  it('returns pure DoctorReport without resolvedAccount and checks merchant+consumer in 1 read-only browser session', async () => {
    const { merchant } = seedMerchantAndConsumer({ withConsumer: true, withPassword: true });
    const beforeRevision = get('SELECT revision FROM auth_states WHERE account_id = ?', merchant.id).revision;
    const browser = createInMemoryBrowserRuntime({ available: true });
    const auth = createInMemoryAuthPort({ merchantVerdict: 'verified', consumerOnline: true });

    const report = await diagnoseEnvironment(
      { account: { accountId: merchant.id, slug: merchant.slug, account: merchant } },
      { browser, auth, log: getLogger() },
    );

    assert.deepEqual(Object.keys(report).sort(), ['failure', 'ok', 'raw', 'view', 'warnings']);
    assert.equal(Object.hasOwn(report, 'resolvedAccount'), false);
    assert.equal(Object.hasOwn(report.raw, 'resolvedAccount'), false);
    assert.equal(Object.hasOwn(report.view, 'resolvedAccount'), false);
    assert.equal(report.ok, true);
    assert.equal(report.failure, null);
    assert.deepEqual(report.warnings, []);
    assert.equal(browser.launches.length, 1);
    assert.equal(browser.derivedContexts.length, 1);
    assertDataContractV2(report.view);
    assert.equal(report.view.chromium.ok, true);
    assert.equal(report.view.logged_in.ok, true);
    assert.equal(report.view.consumer_logged_in.ok, true);
    assert.equal(report.view.password_relogin.has_password, true);

    const afterRevision = get('SELECT revision FROM auth_states WHERE account_id = ?', merchant.id).revision;
    assert.equal(afterRevision, beforeRevision);
  });

  it('fails immediately with E_CHROMIUM_MISSING, starts 0 browsers, and retains legacy_storage_detected', async () => {
    const { merchant } = seedMerchantAndConsumer({ withConsumer: true });
    createLegacyFile();
    const browser = createInMemoryBrowserRuntime({ available: false });
    const auth = createInMemoryAuthPort();

    const report = await diagnoseEnvironment(
      { account: { accountId: merchant.id, slug: merchant.slug, account: merchant } },
      { browser, auth, log: getLogger() },
    );

    assert.equal(report.ok, false);
    assert.equal(report.view, null);
    assert.equal(report.failure.code, 'E_CHROMIUM_MISSING');
    assert.equal(report.failure.exitCode, ExitCodes.GENERAL);
    assert.equal(browser.launches.length, 0);
    assert.equal(browser.derivedContexts.length, 0);
    assert.deepEqual(report.warnings, [{ code: 'legacy_storage_detected' }]);
    assert.deepEqual(report.raw.headline, ['检测到旧版数据，已不再使用，可手动删除']);
  });

  it('starts 0 browsers when neither merchant nor consumer local auth state is readable and retains legacy warning', async () => {
    createLegacyFile('consumer/accounts/registry.json');
    const browser = createInMemoryBrowserRuntime({ available: true });
    const auth = createInMemoryAuthPort();

    const report = await diagnoseEnvironment(
      { account: null },
      { browser, auth, log: getLogger() },
    );

    assert.equal(report.ok, false);
    assert.equal(report.failure.code, 'E_AUTH_STATE_MISSING');
    assert.equal(report.failure.exitCode, ExitCodes.AUTH);
    assert.equal(browser.launches.length, 0);
    assert.deepEqual(report.warnings, [{ code: 'legacy_storage_detected' }]);
  });

  it('opens 1 browser with 0 derived consumer contexts when only merchant is configured', async () => {
    const { merchant } = seedMerchantAndConsumer({ withConsumer: false });
    const browser = createInMemoryBrowserRuntime({ available: true });
    const auth = createInMemoryAuthPort({ merchantVerdict: 'verified' });

    const report = await diagnoseEnvironment(
      { account: merchant },
      { browser, auth, log: getLogger() },
    );

    assert.equal(report.ok, true);
    assert.equal(browser.launches.length, 1);
    assert.equal(browser.derivedContexts.length, 0);
    assert.equal(report.view.consumer_auth_file.ok, false);
    assert.equal(report.view.consumer_logged_in.ok, false);
  });

  it('opens 1 browser when consumer is readable even if merchant auth is missing, then reports E_AUTH_STATE_MISSING', async () => {
    const consumer = insertAccount({ kind: 'consumer', identity: 'uid-1', displayName: 'Buyer A' }, { setDefault: true });
    saveAuthStateSnapshot(VALID_STATE, consumer.id);
    const browser = createInMemoryBrowserRuntime({ available: true });
    const auth = createInMemoryAuthPort({ consumerOnline: true });

    const report = await diagnoseEnvironment(
      { account: null },
      { browser, auth, log: getLogger() },
    );

    assert.equal(report.ok, false);
    assert.equal(report.failure.code, 'E_AUTH_STATE_MISSING');
    assert.equal(browser.launches.length, 1);
    assert.equal(browser.derivedContexts.length, 1);
    assert.equal(report.raw.consumer_logged_in.ok, true);
  });

  it('fails with E_CONSUMER_AUTH_STATE_INVALID and 0 browsers when consumer auth state is corrupted', async () => {
    const { merchant, consumer } = seedMerchantAndConsumer({ withConsumer: true });
    createLegacyFile();
    const browser = createInMemoryBrowserRuntime({ available: true });
    const auth = createInMemoryAuthPort();

    const report = await diagnoseEnvironment(
      { account: merchant },
      {
        browser,
        auth,
        log: getLogger(),
        loadAuthState: (accountId) => {
          if (accountId === consumer.id) {
            throw new Error('corrupt');
          }
          return { exists: true, state: VALID_STATE };
        },
      },
    );

    assert.equal(report.ok, false);
    assert.equal(report.failure.code, 'E_CONSUMER_AUTH_STATE_INVALID');
    assert.equal(browser.launches.length, 0);
    assert.deepEqual(report.warnings, [{ code: 'legacy_storage_detected' }]);
  });

  it('degrades per-account decryption errors in inventory without aborting remaining accounts', async () => {
    const damaged = insertAccount({ identity: '900002', displayName: 'Damaged Shop' });
    saveAuthStateSnapshot(VALID_STATE, damaged.id);
    const healthy = insertAccount({ identity: '900001', displayName: 'Healthy Shop' }, { setDefault: true });
    saveAuthStateSnapshot(VALID_STATE, healthy.id);
    run("UPDATE auth_states SET state_sealed = 'synthetic-tampered' WHERE account_id = ?", damaged.id);

    const browser = createInMemoryBrowserRuntime({ available: true });
    const auth = createInMemoryAuthPort({ merchantVerdict: 'verified', merchantIdentity: { mallId: '900001', displayName: 'Healthy Shop' } });

    const report = await diagnoseEnvironment(
      { account: { accountId: healthy.id, slug: healthy.slug, account: healthy } },
      { browser, auth, log: getLogger() },
    );

    assert.equal(report.ok, true);
    assert.equal(report.view.accounts.length, 2);
    assert.deepEqual(report.view.accounts[0].auth_file, { ok: false, detail: { error: '登录态文件无法解密' } });
    assert.equal(report.view.accounts[1].auth_file.ok, true);
  });

  it('keeps merchant check read-only on rejection without writeback, lease, or relogin', async () => {
    const { merchant } = seedMerchantAndConsumer({ withConsumer: false, withPassword: true });
    const reloginBefore = getReloginState(merchant.id);
    const revisionBefore = get('SELECT revision FROM auth_states WHERE account_id = ?', merchant.id).revision;
    const browser = createInMemoryBrowserRuntime({ available: true });
    const auth = createInMemoryAuthPort({ merchantVerdict: 'rejected' });

    const report = await diagnoseEnvironment(
      { account: merchant },
      { browser, auth, log: getLogger() },
    );

    assert.equal(report.ok, false);
    assert.equal(report.failure.code, 'E_AUTH_EXPIRED');
    assert.equal(report.failure.exitCode, ExitCodes.AUTH);
    assert.equal(browser.launches.length, 1);
    assert.deepEqual(getReloginState(merchant.id), reloginBefore);
    assert.equal(get('SELECT revision FROM auth_states WHERE account_id = ?', merchant.id).revision, revisionBefore);
  });

  it('reports E_CONSUMER_AUTH_EXPIRED when consumer login check returns offline', async () => {
    const { merchant } = seedMerchantAndConsumer({ withConsumer: true });
    const browser = createInMemoryBrowserRuntime({ available: true });
    const auth = createInMemoryAuthPort({ merchantVerdict: 'verified', consumerOnline: false });

    const report = await diagnoseEnvironment(
      { account: merchant },
      { browser, auth, log: getLogger() },
    );

    assert.equal(report.ok, false);
    assert.equal(report.failure.code, 'E_CONSUMER_AUTH_EXPIRED');
    assert.equal(report.failure.exitCode, ExitCodes.AUTH);
    assert.equal(browser.launches.length, 1);
    assert.equal(browser.derivedContexts.length, 1);
  });
});
