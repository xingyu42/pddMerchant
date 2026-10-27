import assert from 'node:assert/strict';
import { it, vi } from 'vitest';
import { insertAccount } from '../../src/infra/account-store.js';
import { get, openDatabase } from '../../src/infra/db.js';
import { loadAuthState, saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { commitMerchantCandidate, withMerchantAuthUpdate } from '../../src/adapter/merchant-auth-storage.js';
import { verifyMerchantContext } from '../../src/adapter/merchant-auth.js';
import { createCliSandbox } from '../helpers/isolated-cli.js';

it('rolls back a failed auth-state transaction and keeps the previous row', async () => {
  const account = insertAccount({ identity: '900001', displayName: 'Shop' });
  const state = { cookies: [], origins: [] };
  saveAuthStateSnapshot(state, account.id);
  const before = get('SELECT * FROM auth_states WHERE account_id = ?', account.id);
  const sandbox = createCliSandbox();
  vi.stubEnv('PDD_TEST_FIXTURE_DIR', sandbox.fixtureDir);
  let candidate;
  try { candidate = (await verifyMerchantContext(null)).candidate; }
  finally { sandbox.dispose(); }
  openDatabase().exec(`CREATE TRIGGER fail_auth BEFORE UPDATE ON auth_states BEGIN SELECT RAISE(ABORT, 'synthetic-secret'); END`);
  await assert.rejects(withMerchantAuthUpdate(account.id, (tx) => commitMerchantCandidate(candidate, tx)), (error) => {
    assert.equal(error.code, 'E_AUTH_STATE_SAVE_FAILED');
    assert.ok(!JSON.stringify(error).includes('synthetic-secret'));
    return true;
  });
  assert.deepEqual(get('SELECT * FROM auth_states WHERE account_id = ?', account.id), before);
  assert.deepEqual(loadAuthState(account.id).state, state);
  assert.equal(get('SELECT count(*) AS total FROM leases').total, 0);
});
