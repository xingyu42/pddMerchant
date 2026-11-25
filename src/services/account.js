// 账号管理领域服务：列表查询、有头登录添加、预演/级联移除（免解密）与默认账号切换。
import { transaction } from '../infra/db.js';
import {
  getAccount,
  getAccountFootprint,
  listAccounts as listAccountsFromStore,
  removeAccount as removeAccountFromStore,
  setDefaultAccount as setDefaultInStore,
} from '../infra/account-store.js';
import { PddCliError, ExitCodes, accountNotFound } from '../infra/errors.js';
import { getReloginSummary } from './relogin-policy.js';
import {
  toAccountAddedView,
  toAccountDefaultView,
  toAccountListView,
  toAccountRemovedView,
} from './views/account.js';

function resolveTargetSlug(slugOrOptions, emptyMessage) {
  const rawSlug = typeof slugOrOptions === 'object' && slugOrOptions !== null
    ? (slugOrOptions.args?.[0] ?? slugOrOptions.slug)
    : slugOrOptions;
  const slug = typeof rawSlug === 'string' ? rawSlug.trim() : '';
  if (!slug) {
    throw new PddCliError({ code: 'E_USAGE', message: emptyMessage, exitCode: ExitCodes.USAGE });
  }
  return slug;
}

/** List merchant accounts with decrypt-free password-relogin summaries projected as v2 data. */
export function listAccounts() {
  const accounts = listAccountsFromStore();
  const defaultSlug = accounts.find((account) => account.is_default)?.slug ?? null;
  return toAccountListView(
    accounts.map((account) => ({ ...account, relogin: getReloginSummary(account.id) })),
    defaultSlug,
  );
}

/** Register or refresh a merchant account through interactive headed login. */
export async function addAccount(options = {}, deps = {}) {
  const authenticate = deps.authenticateMerchant
    ?? (await import('./auth.js')).authenticateMerchant;
  const provisioned = await authenticate(
    {
      ...options,
      account: undefined,
      qr: false,
      headed: true,
      headedNotice: '正在通过有头浏览器登录，请手动完成登录...',
    },
    deps,
  );
  return {
    data: toAccountAddedView(provisioned.account),
    warnings: ['credentials_not_saved_headed_login'],
  };
}

/** Preview or confirm account removal using decrypt-free footprint counts so mismatched master keys remain removable. */
export function removeAccount(slugOrOptions, options = {}) {
  const slug = resolveTargetSlug(slugOrOptions, '请指定要移除的账号 slug');
  const confirm = (
    (typeof slugOrOptions === 'object' && slugOrOptions !== null ? slugOrOptions.confirm : undefined)
    ?? options?.confirm
  ) === true;
  return transaction(() => {
    const account = getAccount(slug);
    if (!account) throw accountNotFound(slug);
    const footprint = getAccountFootprint(account.id);
    if (confirm) removeAccountFromStore(account.slug);
    return toAccountRemovedView(account, footprint, { confirm });
  });
}

/** Switch the default merchant account from positional args or --slug and return v2 view data. */
export function setDefaultAccount(slugOrOptions) {
  const slug = resolveTargetSlug(slugOrOptions, '请指定要设为默认的账号 slug');
  setDefaultInStore(slug);
  return toAccountDefaultView(slug);
}
