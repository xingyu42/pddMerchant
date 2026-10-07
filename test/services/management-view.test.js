import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { toCurrentShopView, toShopListView } from '../../src/services/views/shops.js';
import { toDoctorView, toMerchantLoginView } from '../../src/services/views/auth.js';

describe('management headlines state only known facts', () => {
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

  it('counts auth-state files without calling them saved credentials', () => {
    const view = toDoctorView({
      chromium: { ok: true, detail: {} },
      auth_file: { ok: true, detail: { exists: true, cookies: 1, origins: 0 } },
      logged_in: { ok: true, detail: { configured: true, verdict: 'verified', reason: 'shop_read' } },
      consumer_auth_file: { ok: false, detail: { exists: false } },
      consumer_logged_in: { ok: false, detail: { configured: false } },
      accounts: [{ slug: 'a', displayName: 'A', auth_file: { ok: true, detail: { exists: true } }, hasCredential: false }],
    });
    assert.equal(view.headline[1], '账号登录态文件 1/1 可用');
    assert.ok(view.headline.every((line) => !line.includes('凭据')));
    assert.equal(view.accounts[0].has_credential, false);
  });
});
