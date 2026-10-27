import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { get, run } from '../../src/infra/db.js';
import { insertAccount, updateAccount, listAccounts, getAccount, findAccountByIdentity, setDefaultAccount, removeAccount,
  putCredential, getCredential, putReloginState, getReloginState, insertPendingAction, listPendingActions, resolvePendingAction } from '../../src/infra/account-store.js';
import { saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';

describe('database account store', () => {
  it('enforces unique identity and slug per kind', () => {
    insertAccount({ identity: '1', displayName: 'Shop' });
    assert.throws(() => insertAccount({ identity: '1', displayName: 'Other' }));
    const second = insertAccount({ identity: '2', displayName: 'Shop' });
    assert.notEqual(second.slug, 'shop');
    assert.throws(() => run("UPDATE accounts SET slug = 'shop' WHERE id = ?", second.id));
    const consumer = insertAccount({ kind: 'consumer', identity: '1', displayName: 'Shop' });
    assert.equal(consumer.slug, 'shop');
  });

  it('keeps one default per kind and resolves records by identity and slug', () => {
    const first = insertAccount({ identity: '1', displayName: 'First' }, { setDefault: true });
    const second = insertAccount({ identity: '2', displayName: 'Second' });
    const consumer = insertAccount({ kind: 'consumer', identity: '1', displayName: 'Consumer' }, { setDefault: true });
    setDefaultAccount(second.slug);
    assert.equal(listAccounts().filter((account) => account.is_default).length, 1);
    assert.equal(getAccount(second.slug).is_default, 1);
    assert.equal(findAccountByIdentity('merchant', first.identity).id, first.id);
    assert.equal(getAccount(consumer.slug, { kind: 'consumer' }).is_default, 1);
    assert.throws(() => run('UPDATE accounts SET is_default = 1 WHERE id = ?', first.id));
  });

  it('keeps slugs stable across display name and timestamp changes', () => {
    const account = insertAccount({ identity: '1', displayName: 'First' });
    const updated = updateAccount(account.id, { displayName: 'Renamed', lastLoginAt: '2026-01-01T00:00:00.000Z', disabled: true });
    assert.equal(updated.slug, account.slug);
    assert.equal(updated.display_name, 'Renamed');
    assert.equal(listAccounts().length, 0);
    assert.equal(listAccounts({ includeDisabled: true }).length, 1);
  });

  it('cascades deletion through all reserved account data', () => {
    const account = insertAccount({ identity: '1', displayName: 'First' });
    saveAuthStateSnapshot({ cookies: [], origins: [] }, account.id);
    putCredential(account.id, 'synthetic-sealed');
    putReloginState(account.id, { status: 'available' });
    assert.equal(getCredential(account.id).password_sealed, 'synthetic-sealed');
    assert.equal(getReloginState(account.id).status, 'available');
    const action = insertPendingAction(account.id, { kind: 'human_verification', reason: 'synthetic' });
    assert.throws(() => insertPendingAction(account.id, { kind: 'human_verification', reason: 'duplicate' }));
    resolvePendingAction(action);
    assert.equal(listPendingActions(account.id)[0].status, 'resolved');
    removeAccount(account.slug);
    for (const table of ['auth_states', 'credentials', 'relogin_states', 'pending_actions']) {
      assert.equal(get(`SELECT count(*) AS total FROM ${table}`).total, 0);
    }
    assert.equal(listAccounts().length, 0);
    assert.ok(insertAccount({ identity: '1', displayName: 'Again' }).id > account.id);
  });
});
