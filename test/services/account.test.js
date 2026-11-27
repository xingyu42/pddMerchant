import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'vitest';
import { get, getDatabasePath, run } from '../../src/infra/db.js';
import { putCredential, putReloginState, insertAccount, insertPendingAction, getAccount } from '../../src/infra/account-store.js';
import { ExitCodes } from '../../src/infra/errors.js';
import { saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import {
  listAccounts,
  removeAccount,
  setDefaultAccount,
} from '../../src/services/account.js';
import {
  ACCOUNT_REMOVED_VIEW_FIELDS,
  ACCOUNT_VIEW_FIELDS,
} from '../../src/services/views/account.js';

function seedAccountWithFootprint({ identity = '900001', displayName = 'Shop', isDefault = true } = {}) {
  const account = insertAccount({ identity, displayName }, { setDefault: isDefault });
  putCredential(account.id, 'sealed-placeholder');
  run(
    `INSERT INTO goods_cost_entries(account_id, mall_id, goods_id, purchase_fen, packaging_fen, courier_fen, updated_at)
     VALUES (?, ?, '101', 1, 1, 1, ?)`,
    account.id,
    identity,
    new Date().toISOString(),
  );
  return account;
}

describe('account domain service', () => {
  it('lists empty and populated merchant accounts with decrypt-free relogin summaries', () => {
    const empty = listAccounts();
    assert.deepEqual(empty, {
      headline: ['尚未注册账号'],
      items: [],
      total: 0,
      default_slug: null,
    });

    const first = insertAccount({ identity: '900001', displayName: 'Shop One' }, { setDefault: true });
    const second = insertAccount({ identity: '900002', displayName: 'Shop Two' });
    putCredential(second.id, 'unreadable-sealed-blob');
    putReloginState(second.id, { status: 'blocked', reason: 'wrong_password' });
    insertAccount({ kind: 'consumer', identity: 'uid-1', displayName: 'Buyer' }, { setDefault: true });

    const masterKeyPath = join(dirname(getDatabasePath()), 'master.key');
    assert.equal(existsSync(masterKeyPath), false);

    const listed = listAccounts();
    assert.deepEqual(listed.headline, [`共 2 个账号，默认账号：${first.slug}`]);
    assert.equal(listed.total, 2);
    assert.equal(listed.default_slug, first.slug);
    assert.equal(listed.items.length, 2);
    for (const item of listed.items) {
      assert.deepEqual(Object.keys(item), ACCOUNT_VIEW_FIELDS);
    }
    assert.equal(listed.items[0].is_default, true);
    assert.equal(listed.items[0].has_password, false);
    assert.equal(listed.items[0].password_relogin_status, null);
    assert.equal(listed.items[1].is_default, false);
    assert.equal(listed.items[1].has_password, true);
    assert.equal(listed.items[1].password_relogin_status, '已熔断：密码错误');
  });

  it('previews removal without touching data unless confirmed and cascades on confirm', () => {
    const account = seedAccountWithFootprint();
    const preview = removeAccount(account.slug);
    assert.deepEqual(Object.keys(preview), ACCOUNT_REMOVED_VIEW_FIELDS);
    assert.deepEqual(preview.headline, [
      `预演删除账号 Shop（${account.slug}），连同已存密码、商品成本 1 条，未执行删除`,
      '该账号是默认账号，删除后没有默认账号',
    ]);
    assert.deepEqual(
      [preview.removed, preview.dry_run, preview.has_password, preview.has_login_state, preview.goods_entry_count],
      [false, true, true, false, 1],
    );
    assert.equal(get('SELECT count(*) AS total FROM accounts').total, 1);

    const removed = removeAccount({ args: [account.slug] }, { confirm: true });
    assert.deepEqual([removed.removed, removed.dry_run], [true, false]);
    assert.equal(removed.headline[1], '删除的是默认账号，当前没有默认账号');
    for (const table of ['accounts', 'credentials', 'goods_cost_entries']) {
      assert.equal(get(`SELECT count(*) AS total FROM ${table}`).total, 0);
    }
  });

  it('previews and removes accounts even when master.key is mismatched and ciphertexts are undecryptable', () => {
    const account = seedAccountWithFootprint();
    saveAuthStateSnapshot({ cookies: [{ name: 'PASS_ID', value: 'p1' }], origins: [] }, account.id);
    putReloginState(account.id, { status: 'available' });
    insertPendingAction(account.id, { kind: 'human_takeover', reason: 'sms' });

    // Overwrite master.key with mismatched bytes and corrupt stored ciphertext
    const masterKeyPath = join(dirname(getDatabasePath()), 'master.key');
    writeFileSync(masterKeyPath, Buffer.alloc(32, 0xaa).toString('base64'));
    run("UPDATE auth_states SET state_sealed = 'tampered-ciphertext' WHERE account_id = ?", account.id);

    const preview = removeAccount({ slug: account.slug });
    assert.equal(preview.dry_run, true);
    assert.equal(preview.removed, false);
    assert.equal(preview.has_login_state, true);
    assert.equal(preview.has_password, true);
    assert.equal(preview.goods_entry_count, 1);

    const confirmed = removeAccount({ slug: account.slug, confirm: true });
    assert.equal(confirmed.removed, true);
    assert.equal(confirmed.dry_run, false);
    for (const table of ['accounts', 'auth_states', 'credentials', 'relogin_states', 'pending_actions', 'goods_cost_entries']) {
      assert.equal(get(`SELECT count(*) AS total FROM ${table}`).total, 0);
    }
  });

  it('rejects missing or unknown slugs on removeAccount without deleting data', () => {
    seedAccountWithFootprint();
    assert.throws(() => removeAccount({}), { code: 'E_USAGE', exitCode: ExitCodes.USAGE });
    assert.throws(() => removeAccount({ slug: '   ' }), { code: 'E_USAGE', exitCode: ExitCodes.USAGE });
    assert.throws(() => removeAccount('missing', { confirm: true }), { code: 'E_ACCOUNT_NOT_FOUND', exitCode: ExitCodes.USAGE });
    assert.equal(get('SELECT count(*) AS total FROM accounts').total, 1);
  });

  it('switches default account from positional args or --slug and validates usage', () => {
    const first = insertAccount({ identity: '900001', displayName: 'Shop A' }, { setDefault: true });
    const second = insertAccount({ identity: '900002', displayName: 'Shop B' });

    assert.throws(() => setDefaultAccount(), { code: 'E_USAGE', exitCode: ExitCodes.USAGE });
    assert.throws(() => setDefaultAccount({ args: ['  '] }), { code: 'E_USAGE', exitCode: ExitCodes.USAGE });
    assert.throws(() => setDefaultAccount({ slug: 'unknown' }), { code: 'E_ACCOUNT_NOT_FOUND', exitCode: ExitCodes.USAGE });

    const byPositional = setDefaultAccount({ args: [second.slug] });
    assert.deepEqual(byPositional, {
      headline: [`默认账号已设为 ${second.slug}`],
      slug: second.slug,
      is_default: true,
    });
    assert.equal(getAccount(second.slug).is_default, 1);
    assert.equal(getAccount(first.slug).is_default, 0);

    const bySlugOption = setDefaultAccount({ slug: first.slug });
    assert.equal(bySlugOption.slug, first.slug);
    assert.equal(getAccount(first.slug).is_default, 1);
    assert.equal(getAccount(second.slug).is_default, 0);
  });
});
