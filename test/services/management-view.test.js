import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { toCurrentShopView, toShopListView } from '../../src/services/views/shops.js';
import { toDoctorView, toMerchantLoginView } from '../../src/services/views/auth.js';
import { insertAccount, listAccounts, updateAccount } from '../../src/infra/account-store.js';
import { loadAuthState, saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { toAccountListView, toAccountRemovedView, ACCOUNT_VIEW_FIELDS, ACCOUNT_REMOVED_VIEW_FIELDS } from '../../src/services/views/account.js';

describe('management headlines state only known facts', () => {
  it('separates the removed account slug from the following Chinese text', () => {
    const view = toAccountRemovedView('synthetic-shop');
    assert.deepEqual(view, { headline: ['已移除账号 synthetic-shop 及其认证数据'], slug: 'synthetic-shop', removed: true });
    assert.deepEqual(Object.keys(view).sort(), [...ACCOUNT_REMOVED_VIEW_FIELDS].sort());
  });

  it('does not invent a shop name when it is missing', () => {
    assert.deepEqual(toCurrentShopView({ activeId: '445301049', activeName: '', source: 'state' }).headline, [
      '当前店铺 ID 445301049（未获取到店铺名）',
    ]);
    assert.deepEqual(toShopListView([{ id: '1', name: '' }], '1').headline, ['共 1 个店铺；当前店铺 ID 1（未获取到店铺名）']);
    assert.deepEqual(toCurrentShopView({ activeId: null }).headline, ['未能识别当前店铺']);
    assert.deepEqual(toMerchantLoginView({ identity: { mallId: '1' }, mode: 'qr' }).headline, [
      '商家端授权成功：店铺 ID 1（未获取到店铺名）',
    ]);
  });

  it.each([
    [undefined, '无法判定'],
    [{ ok: true }, '已验证'],
    [{ ok: false }, '无法判定'],
    [{ ok: true, detail: { verdict: null } }, '已验证'],
    [{ ok: false, detail: { verdict: '' } }, '无法判定'],
    [{ ok: true, detail: { verdict: 'rejected' } }, '已失效'],
    [{ ok: false, detail: { verdict: 'verified' } }, '已验证'],
    [{ ok: true, detail: { verdict: 'unrecognized' } }, '未知(unrecognized)'],
  ])('uses the doctor verdict before its ok-based fallback: %j', (loggedIn, verdict) => {
    const view = toDoctorView({ logged_in: loggedIn });
    assert.equal(view.headline[0], `Chromium 不可用；商家端登录态${verdict}；用户端未配置或无效`);
  });

  it('counts auth-state files without calling them saved credentials', () => {
    const first = insertAccount({ identity: '900001', displayName: 'A' });
    insertAccount({ identity: '900002', displayName: 'B' });
    saveAuthStateSnapshot({ cookies: [], origins: [] }, first.id);
    const accounts = listAccounts().map((account) => ({ slug: account.slug, displayName: account.display_name,
      auth_file: { ok: loadAuthState(account.id).exists, detail: { exists: loadAuthState(account.id).exists } } }));
    const view = toDoctorView({
      chromium: { ok: true, detail: {} },
      auth_file: { ok: true, detail: { exists: true, cookies: 1, origins: 0 } },
      logged_in: { ok: true, detail: { configured: true, verdict: 'verified', reason: 'shop_read' } },
      consumer_auth_file: { ok: false, detail: { exists: false } },
      consumer_logged_in: { ok: false, detail: { configured: false } },
      accounts,
    });
    assert.equal(view.headline[1], '账号登录态文件 1/2 可用');
    assert.ok(view.headline.every((line) => !line.includes('凭据')));
    assert.equal(Object.hasOwn(view.accounts[0], 'has_credential'), false);
  });

  it('projects account status and timestamps from database rows without retired fields', () => {
    const first = insertAccount({ identity: '900001', displayName: 'A' }, { setDefault: true });
    updateAccount(first.id, { disabled: true, lastLoginAt: '2026-01-01T00:00:00.000Z' });
    const view = toAccountListView(listAccounts({ includeDisabled: true }), first.slug);
    assert.deepEqual(Object.keys(view.items[0]).sort(), [...ACCOUNT_VIEW_FIELDS].sort());
    assert.equal(view.items[0].disabled, true);
    assert.equal(view.items[0].is_default, true);
    assert.equal(view.items[0].last_login_at, '2026-01-01 08:00:00');
    assert.equal(Object.hasOwn(view.items[0], 'has_credential'), false);
    assert.equal(Object.hasOwn(view.items[0], 'last_refresh_at'), false);
  });
});
