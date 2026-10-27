import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';
import { mockMerchantProbeTransport } from '../helpers/merchant-probe-transport.js';

vi.mock('../../src/adapter/browser.js', () => ({
  createSnapshotContext: vi.fn(async (_browser, state) => ({
    cookies: async () => structuredClone(state.cookies), close: vi.fn(async () => {}),
  })),
}));
import { verifyMerchantContext, assertMerchantVerified } from '../../src/adapter/merchant-auth.js';
import { withMerchantAuthUpdate, commitMerchantCandidate, recordMerchantCheck, boundMerchantMallId, assertAuthTask } from '../../src/adapter/merchant-auth-storage.js';
import { saveAuthStateSnapshot, loadAuthState } from '../../src/adapter/auth-state.js';
import { insertAccount, putReloginState } from '../../src/infra/account-store.js';
import { acquireLease } from '../../src/infra/leases.js';
import { get, run, isInTransaction } from '../../src/infra/db.js';
import { seal, aad } from '../../src/infra/secret-box.js';
import { redactRecursive, getLogger } from '../../src/infra/logger.js';
import { PddCliError, ExitCodes } from '../../src/infra/errors.js';

const state = { cookies: [{ name: 'PASS_ID', value: 'synthetic', domain: '.pinduoduo.com', path: '/', secure: true }], origins: [] };
let accountId;

async function candidate(options) {
  const context = { storageState: async () => structuredClone(state), browser: () => ({}) };
  const result = await verifyMerchantContext(context, options);
  assertMerchantVerified(result);
  return result.candidate;
}

beforeEach(() => {
  vi.stubEnv('PDD_TEST_ADAPTER', '');
  accountId = insertAccount({ identity: '900001', displayName: 'Shop' }).id;
  mockMerchantProbeTransport();
});

describe('leased verified merchant state', () => {
  it.each([
    { outcome: 'success', logFails: false }, { outcome: 'error', logFails: false },
    { outcome: 'success', logFails: true }, { outcome: 'error', logFails: true },
  ])('preserves the original $outcome when releasing the lease fails (logging failure: $logFails)', async ({ outcome, logFails }) => {
    const warn = vi.spyOn(getLogger(), 'warn').mockImplementation(() => {
      if (logFails) throw new Error('synthetic private log path');
    });
    const failure = new PddCliError({ code: 'E_AUTH_CANCELLED', message: 'synthetic original error', exitCode: 5 });
    run(`CREATE TRIGGER fail_lease_release BEFORE DELETE ON leases
      BEGIN SELECT RAISE(ABORT, 'synthetic secret and private path'); END`);
    const operation = withMerchantAuthUpdate(accountId, async (tx) => {
      if (outcome === 'error') throw failure;
      commitMerchantCandidate(await candidate(), tx);
      return 'saved';
    });
    if (outcome === 'error') await assert.rejects(operation, (error) => error === failure);
    else {
      assert.equal(await operation, 'saved');
      assert.equal(loadAuthState(accountId).revision, 1);
    }
    assert.deepEqual(warn.mock.calls, [[{ code: 'auth_lease_release_failed' }, '认证租约释放失败']]);
  });

  it('rejects a different stable shop before returning a candidate', async () => {
    const result = await verifyMerchantContext({ storageState: async () => state, browser: () => ({}) }, { expectedMallId: '900002' });
    assert.equal(result.reason, 'identity_mismatch');
    assert.ok(!Object.hasOwn(result, 'candidate'));
    assert.throws(() => assertMerchantVerified(result), { code: 'E_ACCOUNT_IDENTITY_MISMATCH' });
  });

  it('commits a detached branded snapshot and supports multiple commits outside long transactions', async () => {
    const verified = await candidate();
    assert.ok(Object.isFrozen(verified.state.cookies[0]));
    await withMerchantAuthUpdate(accountId, async (tx) => {
      assert.equal(isInTransaction(), false);
      await Promise.resolve();
      commitMerchantCandidate(verified, tx);
      assert.equal(tx.revision, 1);
      commitMerchantCandidate(verified, tx);
      assert.equal(tx.revision, 2);
      assert.equal(tx.state.merchant_auth.mall_id, '900001');
    });
    const saved = loadAuthState(accountId);
    assert.deepEqual(saved.state.cookies, state.cookies);
    assert.equal(saved.state.merchant_auth.scope, 'shop_read');
    assert.equal(saved.state.merchant_auth.check_verdict, 'verified');
    assert.equal(get('SELECT count(*) AS total FROM leases').total, 0);
  });

  it('rejects arbitrary objects pretending to be verified', async () => {
    await assert.rejects(withMerchantAuthUpdate(accountId, (tx) => commitMerchantCandidate({ state, identity: { mallId: '900001' } }, tx)),
      { code: 'E_AUTH_CANDIDATE_INVALID' });
    assert.equal(loadAuthState(accountId).exists, false);
  });

  it('preserves existing binding and registered recovery identity checks', async () => {
    saveAuthStateSnapshot({ ...state, merchant_auth: { version: 1, mall_id: '900002' } }, accountId);
    const before = get('SELECT * FROM auth_states WHERE account_id = ?', accountId);
    await assert.rejects(withMerchantAuthUpdate(accountId, async (tx) => commitMerchantCandidate(await candidate(), tx),
      { recoveryMallId: '900001' }), { code: 'E_ACCOUNT_IDENTITY_MISMATCH' });
    assert.deepEqual(get('SELECT * FROM auth_states WHERE account_id = ?', accountId), before);
    for (const metadata of [{ version: 2, mall_id: '900001' }, { version: 1, mall_id: {} }]) {
      assert.throws(() => boundMerchantMallId({ merchant_auth: metadata }), { code: 'E_AUTH_STATE_CORRUPT' });
    }
  });

  it('allows shape recovery only for a trusted registered identity, and fails closed on ciphertext damage', async () => {
    saveAuthStateSnapshot(state, accountId);
    run('UPDATE auth_states SET state_sealed = ? WHERE account_id = ?', seal({ cookies: [] }, aad('auth_states', accountId)), accountId);
    await assert.rejects(withMerchantAuthUpdate(accountId, vi.fn()), { code: 'E_AUTH_STATE_CORRUPT' });
    await withMerchantAuthUpdate(accountId, async (tx) => {
      assert.equal(tx.corrupt, true);
      commitMerchantCandidate(await candidate(), tx);
    }, { recoveryMallId: '900001' });
    run("UPDATE auth_states SET state_sealed = 'damaged' WHERE account_id = ?", accountId);
    await assert.rejects(withMerchantAuthUpdate(accountId, vi.fn(), { recoveryMallId: '900001' }), { code: 'E_SECRET_DECRYPT_FAILED' });
  });

  it('enforces external CAS, expectedRevision and lease ownership', async () => {
    saveAuthStateSnapshot(state, accountId);
    await assert.rejects(withMerchantAuthUpdate(accountId, async (tx) => {
      saveAuthStateSnapshot(state, accountId);
      commitMerchantCandidate(await candidate(), tx);
    }), { code: 'E_AUTH_STATE_CONFLICT' });
    await assert.rejects(withMerchantAuthUpdate(accountId, async (tx) => {
      commitMerchantCandidate(await candidate(), tx, { expectedRevision: 0 });
    }), { code: 'E_AUTH_STATE_CONFLICT' });
    await assert.rejects(withMerchantAuthUpdate(accountId, async (tx) => {
      run("UPDATE leases SET owner_token = 'other' WHERE scope = 'account' AND key = ?", String(accountId));
      commitMerchantCandidate(await candidate(), tx);
    }), { code: 'E_AUTH_LOCK_LOST' });
    run('DELETE FROM leases');
    assert.equal(loadAuthState(accountId).revision, 2);
  });

  it('checks cancellation and deadline immediately before commit and always releases the lease', async () => {
    const controller = new AbortController();
    await assert.rejects(withMerchantAuthUpdate(accountId, async (tx) => {
      const verified = await candidate();
      controller.abort();
      commitMerchantCandidate(verified, tx);
    }, { signal: controller.signal }), { code: 'E_AUTH_CANCELLED' });
    await assert.rejects(withMerchantAuthUpdate(accountId, async (tx) => {
      const verified = await candidate();
      tx.deadlineAt = Date.now() - 1;
      commitMerchantCandidate(verified, tx);
    }), { code: 'E_AUTH_TIMEOUT' });
    assert.equal(loadAuthState(accountId).exists, false);
    assert.equal(get('SELECT count(*) AS total FROM leases').total, 0);
    controller.abort();
    assert.throws(() => assertAuthTask({ signal: controller.signal }), { code: 'E_AUTH_CANCELLED' });
    const timeout = new AbortController();
    timeout.abort(new PddCliError({ code: 'E_AUTH_TIMEOUT', exitCode: ExitCodes.NETWORK }));
    assert.throws(() => assertAuthTask({ signal: timeout.signal, deadlineAt: Date.now() + 100 }), { code: 'E_AUTH_TIMEOUT' });
  });

  it('serializes account leases and loads after acquiring ownership', async () => {
    let started;
    let release;
    const ready = new Promise((resolve) => { started = resolve; });
    const hold = new Promise((resolve) => { release = resolve; });
    const first = withMerchantAuthUpdate(accountId, async (tx) => {
      started(); await hold; commitMerchantCandidate(await candidate(), tx);
    });
    await ready;
    const second = withMerchantAuthUpdate(accountId, async (tx) => {
      assert.equal(tx.revision, 1);
      commitMerchantCandidate(await candidate(), tx);
    });
    release();
    await Promise.all([first, second]);
    assert.equal(loadAuthState(accountId).revision, 2);
  });

  it('extends the default wait only for a recent relogin and loads its new revision', async () => {
    const verified = await candidate();
    vi.useFakeTimers();
    let release;
    let started;
    const hold = new Promise((resolve) => { release = resolve; });
    const ready = new Promise((resolve) => { started = resolve; });
    const first = withMerchantAuthUpdate(accountId, async (tx) => {
      putReloginState(accountId, { status: 'available', lastAttemptAt: new Date().toISOString() });
      started();
      await hold;
      commitMerchantCandidate(verified, tx);
    });
    await ready;
    const second = withMerchantAuthUpdate(accountId, (tx) => {
      assert.equal(tx.revision, 1);
      commitMerchantCandidate(verified, tx);
    });
    await vi.advanceTimersByTimeAsync(15001);
    release();
    await vi.advanceTimersByTimeAsync(300);
    await Promise.all([first, second]);
    assert.equal(loadAuthState(accountId).revision, 2);
  });

  it.each(['missing', 'old'])('keeps the normal 15s wait for a %s relogin attempt', async (attempt) => {
    vi.useFakeTimers();
    await acquireLease('account', accountId);
    if (attempt === 'old') putReloginState(accountId, { status: 'available', lastAttemptAt: new Date(Date.now() - 90001).toISOString() });
    const waiting = assert.rejects(withMerchantAuthUpdate(accountId, vi.fn()), { code: 'E_LOCK_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(15001);
    await waiting;
  });

  it('preserves cookies when recording rejection or uncertainty', async () => {
    saveAuthStateSnapshot(state, accountId);
    for (const verdict of ['rejected', 'indeterminate']) {
      await withMerchantAuthUpdate(accountId, (tx) => recordMerchantCheck({ verdict, reason: 'synthetic', checked_at: new Date().toISOString() }, tx));
      const saved = loadAuthState(accountId).state;
      assert.deepEqual(saved.cookies, state.cookies);
      assert.equal(saved.merchant_auth.last_check.verdict, verdict);
      assert.equal(saved.merchant_auth.usable, false);
    }
  });

  it('redacts credential aliases and sealed material', () => {
    const keys = ['LoginToken', 'login_token', 'PASS_ID', 'cookie_headers', 'state_sealed', 'password_sealed', 'master_key'];
    const redacted = redactRecursive(Object.fromEntries(keys.map((key) => [key, 'synthetic-secret'])));
    for (const key of keys) {
      if (['password_sealed', 'master_key'].includes(key)) assert.equal(redacted[key], '[REDACTED]');
      else assert.match(redacted[key], /^fp:/);
    }
    assert.ok(!JSON.stringify(redacted).includes('synthetic-secret'));
  });

  it('keeps tag, ct and iv account keys intact while redacting sealed fields', () => {
    const accounts = Object.fromEntries(['tag', 'ct', 'iv'].map((slug) => [slug, { ok: true, data: { slug } }]));
    const redacted = redactRecursive({ accounts, state_sealed: 'synthetic-state', password_sealed: 'synthetic-password', master_key: 'synthetic-key' });
    assert.deepEqual(redacted.accounts, accounts);
    assert.match(redacted.state_sealed, /^fp:/);
    for (const key of ['password_sealed', 'master_key']) assert.equal(redacted[key], '[REDACTED]');
  });
});
