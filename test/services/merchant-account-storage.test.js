import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';
import { mockMerchantProbeTransport } from '../helpers/merchant-probe-transport.js';

const control = vi.hoisted(() => ({ mallId: 900001, onLoginPage: null }));
vi.mock('../../src/adapter/browser.js', () => ({
  launchBrowser: vi.fn(async ({ storageState }) => {
    let current = structuredClone(storageState ?? { cookies: [], origins: [] });
    const context = { browser: () => ({}), storageState: async () => structuredClone(current),
      cookies: async () => structuredClone(current.cookies), close: async () => {} };
    const page = { goto: async () => control.onLoginPage(() => { current = structuredClone(state); }), close: async () => {} };
    return { browser: {}, context, page };
  }),
  closeBrowser: vi.fn(async () => {}),
  createSnapshotContext: async (_browser, snapshot) => ({ cookies: async () => snapshot.cookies, close: async () => {} }),
}));
vi.mock('../../src/infra/output.js', () => ({ emit: vi.fn((envelope) => envelope) }));
import { verifyMerchantContext, assertMerchantVerified } from '../../src/adapter/merchant-auth.js';
import { provisionMerchantLogin, provisionConsumerAuth } from '../../src/services/auth-account-storage.js';
import { insertAccount, findAccountByIdentity, removeAccount, setDefaultAccount, getAccountById } from '../../src/infra/account-store.js';
import { loadAuthState, saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { openDatabase, run, get, isInTransaction } from '../../src/infra/db.js';
import { seal, aad } from '../../src/infra/secret-box.js';
import { runInteractiveLogin } from '../../src/commands/init.js';
import { launchBrowser } from '../../src/adapter/browser.js';
import * as authService from '../../src/services/auth.js';
import { TIMEOUTS } from '../../src/infra/timeouts.js';
import { acquireLease, releaseLease } from '../../src/infra/leases.js';

const state = { cookies: [{ name: 'PASS_ID', value: 'synthetic' }], origins: [] };
beforeEach(() => {
  vi.stubEnv('PDD_TEST_ADAPTER', '');
  control.mallId = 900001;
  control.onLoginPage = (authorize) => authorize();
  launchBrowser.mockClear();
  mockMerchantProbeTransport(() => ({ mallId: control.mallId, mallName: 'Renamed Shop' }));
});

async function verifiedResult() {
  const result = await verifyMerchantContext({ storageState: async () => state, browser: () => ({}) });
  assertMerchantVerified(result);
  return result;
}

describe('atomic merchant login registration', () => {
  it.each([
    { timeout: 1200, expected: 1200 },
    { timeout: NaN, expected: TIMEOUTS.QR_CAPTURE },
    { timeout: Infinity, expected: TIMEOUTS.QR_CAPTURE },
    { timeout: '1200', expected: TIMEOUTS.QR_CAPTURE },
    { timeout: undefined, expected: TIMEOUTS.QR_CAPTURE },
  ])('uses a finite numeric QR capture timeout for $timeout', async ({ timeout, expected }) => {
    const login = vi.spyOn(authService, 'performQrLogin').mockImplementation(verifiedResult);
    const result = await runInteractiveLogin({ qr: true, timeout, timeoutMs: 5000, json: true });
    assert.equal(result.ok, true);
    assert.equal(login.mock.calls.length, 1);
    assert.equal(login.mock.calls[0][0].qrCaptureTimeoutMs, expected);
  });

  it('registers the first verified account atomically and reuses mall identity with stable slug', async () => {
    const first = await provisionMerchantLogin(async () => {
      assert.equal(isInTransaction(), false);
      return verifiedResult();
    });
    assert.equal(first.account.identity, '900001');
    assert.equal(first.account.is_default, 1);
    assert.equal(loadAuthState(first.accountId).revision, 1);
    const second = await provisionMerchantLogin(verifiedResult);
    assert.equal(second.accountId, first.accountId);
    assert.equal(second.account.slug, first.account.slug);
    assert.equal(loadAuthState(first.accountId).revision, 2);
  });

  it('keeps a selected slug and updates its display name after matching verification', async () => {
    const existing = insertAccount({ identity: '900001', displayName: 'Original' });
    saveAuthStateSnapshot(state, existing.id);
    const registered = await provisionMerchantLogin(verifiedResult, { accountId: existing.id });
    assert.equal(registered.account.slug, 'original');
    assert.equal(registered.account.display_name, 'Renamed Shop');
    assert.equal(loadAuthState(existing.id).state.merchant_auth.mall_id, '900001');
  });

  it('saves an existing identity without --account while holding its account lease', async () => {
    const existing = insertAccount({ identity: '900001', displayName: 'Original' });
    saveAuthStateSnapshot(state, existing.id);
    openDatabase().exec(`CREATE TRIGGER require_login_lease BEFORE UPDATE ON auth_states
      WHEN NOT EXISTS (SELECT 1 FROM leases WHERE scope = 'account' AND key = CAST(NEW.account_id AS TEXT))
      BEGIN SELECT RAISE(ABORT, 'missing account lease'); END`);
    const result = await provisionMerchantLogin(verifiedResult);
    assert.equal(result.accountId, existing.id);
    assert.equal(result.account.slug, existing.slug);
    assert.equal(loadAuthState(existing.id).revision, 2);
    assert.equal(get('SELECT count(*) AS total FROM leases').total, 0);
  });

  it('times out without --account when another live owner holds the existing account lease', async () => {
    const existing = insertAccount({ identity: '900001', displayName: 'Original' });
    saveAuthStateSnapshot(state, existing.id);
    const before = get('SELECT * FROM auth_states WHERE account_id = ?', existing.id);
    const lock = await acquireLease('account', existing.id);
    try {
      await assert.rejects(provisionMerchantLogin(verifiedResult, { deadlineAt: Date.now() + 200 }), { code: 'E_LOCK_TIMEOUT' });
      assert.deepEqual(get('SELECT * FROM auth_states WHERE account_id = ?', existing.id), before);
      assert.deepEqual(getAccountById(existing.id), existing);
      assert.equal(get("SELECT owner_token FROM leases WHERE scope = 'account' AND key = ?", String(existing.id)).owner_token, lock.token);
    } finally { releaseLease('account', existing.id, lock.token); }
  });

  it('rejects a newer target revision without overwriting it', async () => {
    const existing = insertAccount({ identity: '900001', displayName: 'Original' });
    saveAuthStateSnapshot(state, existing.id);
    await assert.rejects(provisionMerchantLogin(async () => {
      const result = await verifiedResult();
      saveAuthStateSnapshot(state, existing.id);
      return result;
    }, { accountId: existing.id }), { code: 'E_AUTH_STATE_CONFLICT' });
    assert.equal(loadAuthState(existing.id).revision, 2);
  });

  it('remove and default complete during login, and deleted accounts are never resurrected', async () => {
    const existing = insertAccount({ identity: '900001', displayName: 'Original' });
    const other = insertAccount({ identity: '900002', displayName: 'Other' });
    await assert.rejects(provisionMerchantLogin(async () => {
      const result = await verifiedResult();
      setDefaultAccount(other.slug);
      assert.equal(getAccountById(other.id).is_default, 1);
      removeAccount(existing.slug);
      assert.equal(findAccountByIdentity('merchant', '900001'), null);
      return result;
    }, { accountId: existing.id }), { code: 'E_AUTH_STATE_CONFLICT' });
    assert.equal(findAccountByIdentity('merchant', '900001'), null);
  });

  it('also conflicts if the removed identity is registered again with a new id', async () => {
    const existing = insertAccount({ identity: '900001', displayName: 'Original' });
    await assert.rejects(provisionMerchantLogin(async () => {
      const result = await verifiedResult();
      removeAccount(existing.slug);
      const replacement = insertAccount({ identity: '900001', displayName: 'Replacement' });
      assert.notEqual(replacement.id, existing.id);
      return result;
    }, { accountId: existing.id }), { code: 'E_AUTH_STATE_CONFLICT' });
  });

  it('rolls back a new account and auth-state together on final account update failure', async () => {
    openDatabase().exec("CREATE TRIGGER fail_account BEFORE UPDATE ON accounts WHEN NEW.last_login_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'synthetic-secret'); END");
    await assert.rejects(provisionMerchantLogin(verifiedResult), (error) => {
      assert.equal(error.code, 'E_AUTH_ACCOUNT_SAVE_FAILED');
      assert.ok(!JSON.stringify(error).includes('synthetic-secret'));
      return true;
    });
    assert.equal(findAccountByIdentity('merchant', '900001'), null);
    assert.equal(get('SELECT count(*) AS total FROM auth_states').total, 0);
    assert.ok(get("SELECT value FROM meta WHERE key = 'master_key_fingerprint'"));
  });

  it('rejects a registration identity that disagrees with the branded candidate', async () => {
    await assert.rejects(provisionMerchantLogin(async () => {
      const result = await verifiedResult();
      return { ...result, identity: { mallId: '900002', displayName: 'Wrong' } };
    }), { code: 'E_ACCOUNT_IDENTITY_MISMATCH' });
    assert.equal(findAccountByIdentity('merchant', '900001'), null);
    assert.equal(findAccountByIdentity('merchant', '900002'), null);
  });

  it('preserves the binding when a selected login verifies a different shop', async () => {
    const existing = insertAccount({ identity: '900002', displayName: 'Other' });
    await assert.rejects(provisionMerchantLogin(verifiedResult, { accountId: existing.id }), { code: 'E_ACCOUNT_IDENTITY_MISMATCH' });
    assert.equal(loadAuthState(existing.id).exists, false);
  });

  it('uses an empty browser context for trusted shape recovery, then commits only after authorization', async () => {
    const existing = insertAccount({ identity: '900001', displayName: 'Original' });
    saveAuthStateSnapshot(state, existing.id);
    const damaged = seal({ cookies: [] }, aad('auth_states', existing.id));
    run('UPDATE auth_states SET state_sealed = ? WHERE account_id = ?', damaged, existing.id);
    control.onLoginPage = (authorize) => {
      assert.equal(launchBrowser.mock.calls[0][0].storageState, undefined);
      assert.equal(get('SELECT state_sealed FROM auth_states WHERE account_id = ?', existing.id).state_sealed, damaged);
      authorize();
    };
    const result = await runInteractiveLogin({ account: existing.slug, json: true, timeoutMs: 5000 });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(result.data.account_slug, existing.slug);
    assert.equal(loadAuthState(existing.id).revision, 2);
  });
});

describe('consumer login identity', () => {
  it('keeps the slug stable by uid when nickname changes and updates login timestamps', () => {
    const first = provisionConsumerAuth(state, { uid: 'user-1', nickname: 'Original' });
    const second = provisionConsumerAuth(state, { uid: 'user-1', nickname: 'Renamed' });
    assert.equal(second.accountId, first.accountId);
    assert.equal(second.account.slug, 'original');
    assert.equal(second.account.display_name, 'Renamed');
    assert.equal(second.account.is_default, 1);
    assert.ok(second.account.last_login_at);
    assert.ok(second.account.last_used_at);
    assert.equal(loadAuthState(second.accountId).revision, 2);
  });

  it('rolls back consumer registration when the storage snapshot is invalid', () => {
    assert.throws(() => provisionConsumerAuth({}, { uid: 'user-1', nickname: 'Original' }), { code: 'E_AUTH_STATE_CORRUPT' });
    assert.equal(findAccountByIdentity('consumer', 'user-1'), null);
  });
});
