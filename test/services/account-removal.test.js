import assert from 'node:assert/strict';
import { it } from 'vitest';
import { get, run } from '../../src/infra/db.js';
import { insertAccount, putCredential } from '../../src/infra/account-store.js';
import { removeAccountView } from '../../src/services/account-removal.js';
import { ACCOUNT_REMOVED_VIEW_FIELDS } from '../../src/services/views/account.js';

function seed() {
  const account = insertAccount({ identity: '900001', displayName: 'Shop' }, { setDefault: true });
  putCredential(account.id, 'sealed-placeholder');
  run(`INSERT INTO goods_cost_entries(account_id, mall_id, goods_id, purchase_fen, packaging_fen, courier_fen, updated_at)
    VALUES (?, '900001', '101', 1, 1, 1, ?)`, account.id, new Date().toISOString());
  return account;
}

it('previews removal without touching data unless confirmed', () => {
  const account = seed();
  const preview = removeAccountView(account.slug);
  assert.deepEqual(Object.keys(preview), ACCOUNT_REMOVED_VIEW_FIELDS);
  assert.deepEqual(preview.headline, [`预演删除账号 Shop（${account.slug}），连同已存密码、商品成本 1 条，未执行删除`,
    '该账号是默认账号，删除后没有默认账号']);
  assert.deepEqual([preview.removed, preview.dry_run, preview.has_password, preview.has_login_state, preview.goods_entry_count],
    [false, true, true, false, 1]);
  assert.equal(get('SELECT count(*) AS total FROM accounts').total, 1);
  const removed = removeAccountView(account.slug, { confirm: true });
  assert.deepEqual([removed.removed, removed.dry_run], [true, false]);
  assert.equal(removed.headline[1], '删除的是默认账号，当前没有默认账号');
  for (const table of ['accounts', 'credentials', 'goods_cost_entries']) {
    assert.equal(get(`SELECT count(*) AS total FROM ${table}`).total, 0);
  }
});

it('reports unknown slugs without deleting anything', () => {
  seed();
  assert.throws(() => removeAccountView('missing', { confirm: true }), { code: 'E_ACCOUNT_NOT_FOUND' });
  assert.equal(get('SELECT count(*) AS total FROM accounts').total, 1);
});
