import { PddCliError, ExitCodes, accountNotFound, accountRequired } from './errors.js';
import { getAccount, getAccountById, listAccounts } from './account-store.js';

function contextOf(account, source, warnings) {
  return { accountId: account?.id ?? null, slug: account?.slug ?? null,
    displayName: account?.display_name ?? null, account, source, warnings };
}

export async function resolveAccountContext({ account, accountId, needsAuth = true, warnings = [] } = {}) {
  if (account || accountId != null) {
    const found = accountId != null ? getAccountById(accountId) : getAccount(account, { allowDisplayName: true });
    if (!found || found.kind !== 'merchant') throw accountNotFound(account ?? String(accountId));
    return contextOf(found, 'flag', warnings);
  }
  const accounts = listAccounts();
  const selected = accounts.find((entry) => entry.is_default);
  if (selected) return contextOf(selected, 'default', warnings);
  if (accounts.length === 1) return contextOf(accounts[0], 'auto-single', warnings);
  if (accounts.length > 1) throw accountRequired();
  if (needsAuth) {
    throw new PddCliError({ code: 'E_AUTH_EXPIRED', message: '尚未登录商家账号', hint: '执行 pdd login 完成授权', exitCode: ExitCodes.AUTH });
  }
  return contextOf(null, null, warnings);
}

export function accountMetaForEnvelope(accountContext) {
  if (!accountContext || !accountContext.slug) return {};
  return {
    account: accountContext.slug,
    account_display_name: accountContext.displayName,
    account_source: accountContext.source,
  };
}
