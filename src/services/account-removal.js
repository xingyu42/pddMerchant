import { transaction } from '../infra/db.js';
import { getAccount, getAccountFootprint, removeAccount } from '../infra/account-store.js';
import { accountNotFound } from '../infra/errors.js';
import { toAccountRemovedView } from './views/account.js';

// 只读计数、不解密：主密钥不配套时仍可预演并删除。
export function removeAccountView(slug, { confirm = false } = {}) {
  return transaction(() => {
    const account = getAccount(slug);
    if (!account) throw accountNotFound(slug);
    const footprint = getAccountFootprint(account.id);
    if (confirm) removeAccount(account.slug);
    return toAccountRemovedView(account, footprint, { confirm });
  });
}
