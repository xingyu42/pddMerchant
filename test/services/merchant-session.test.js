import assert from 'node:assert/strict';
import { it, vi } from 'vitest';
import * as authStorage from '../../src/adapter/merchant-auth-storage.js';
import * as relogin from '../../src/services/password-relogin.js';
import { insertAccount } from '../../src/infra/account-store.js';
import { get } from '../../src/infra/db.js';
import { loadAuthState, saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { createFixtureReloginContext } from '../../src/adapter/fixtures/auth.js';
import { checkMerchantSession } from '../../src/services/merchant-session.js';

const checkedAt = '2026-11-07T00:00:00.000Z';

function setup(verdict) {
  const account = insertAccount({ identity: '900001', displayName: 'Shop' });
  saveAuthStateSnapshot({ cookies: [], origins: [] }, account.id);
  const result = { verdict, reason: verdict === 'rejected' ? 'login_false' : 'network_error', checked_at: checkedAt };
  vi.spyOn(authStorage, 'verifyStoredMerchant').mockResolvedValue(result);
  return { account, result };
}

it.each(['rejected', 'indeterminate'])('report mode returns %s without acquiring a lease, recording or recovering', async (verdict) => {
  const { account, result } = setup(verdict);
  const recover = vi.spyOn(relogin, 'reloginInCommand');
  const before = loadAuthState(account.id);
  const session = await checkMerchantSession(null, { state: before.state, mode: 'report' });
  assert.deepEqual(session.result, result);
  assert.deepEqual(loadAuthState(account.id), before);
  assert.equal(get('SELECT COUNT(*) AS total FROM leases').total, 0);
  assert.equal(recover.mock.calls.length, 0);
});

it('login mode records rejection and returns control for human authorization', async () => {
  const { account, result } = setup('rejected');
  const recover = vi.spyOn(relogin, 'reloginInCommand');
  await authStorage.withMerchantAuthUpdate(account.id, async (tx) => {
    const session = await checkMerchantSession(null, { tx, mode: 'login' });
    assert.deepEqual(session.result, result);
    assert.equal(session.replacement, undefined);
    assert.equal(tx.revision, 2);
  });
  assert.deepEqual(loadAuthState(account.id).metadata.last_check, result);
  assert.equal(recover.mock.calls.length, 0);
});

it.each(['command', 'login', 'patrol'])('%s mode records indeterminate checks and leaves recovery untouched', async (mode) => {
  const { account, result } = setup('indeterminate');
  const recover = vi.spyOn(relogin, 'reloginInCommand');
  await authStorage.withMerchantAuthUpdate(account.id, async (tx) => {
    await assert.rejects(checkMerchantSession(null, { tx, mode }), { code: 'E_AUTH_CHECK_INDETERMINATE' });
  });
  assert.equal(loadAuthState(account.id).revision, 2);
  assert.deepEqual(loadAuthState(account.id).metadata.last_check, result);
  assert.equal(recover.mock.calls.length, 0);
});

it('command mode records rejection before recovery and returns the replacement session', async () => {
  const { account, result } = setup('rejected');
  const replacement = { context: {}, page: {} };
  const runtime = { signal: new AbortController().signal };
  const browser = {};
  vi.spyOn(relogin, 'reloginInCommand').mockImplementation(async (task, tx, instance, rejected) => {
    assert.equal(task, runtime);
    assert.equal(instance, browser);
    assert.deepEqual(rejected, result);
    assert.equal(tx.revision, 2);
    assert.deepEqual(loadAuthState(account.id).metadata.last_check, result);
    return replacement;
  });
  await authStorage.withMerchantAuthUpdate(account.id, async (tx) => {
    const session = await checkMerchantSession(null, { tx, runtime, browser });
    assert.equal(session.replacement, replacement);
  });
});

it('snapshot mode verifies fresh material after a known rejection and leaves persistence to the caller', async () => {
  const { account } = setup('rejected');
  await authStorage.withMerchantAuthUpdate(account.id, async (tx) => {
    authStorage.recordMerchantCheck({ verdict: 'rejected', reason: 'login_false', checked_at: checkedAt }, tx);
    const { result } = await checkMerchantSession(createFixtureReloginContext(account.identity), {
      tx, mode: 'snapshot', task: { expectedMallId: account.identity },
    });
    assert.equal(result.verdict, 'verified');
    assert.ok(result.candidate);
    assert.equal(tx.revision, 2);
    assert.equal(loadAuthState(account.id).metadata.last_check.verdict, 'rejected');
  });
});
