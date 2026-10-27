import { PddCliError, ExitCodes } from './errors.js';
import { getAccount, listAccounts } from './account-store.js';

function contextOf(account, source, warnings) {
  return { accountId: account?.id ?? null, slug: account?.slug ?? null,
    displayName: account?.display_name ?? null, account, source, warnings };
}

export async function resolveConsumerAccountContext({ account, needsAuth = true, warnings = [] } = {}) {
  if (account) {
    const found = getAccount(account, { kind: 'consumer', allowDisplayName: true });
    if (!found) throw missingAccount();
    return contextOf(found, 'flag', warnings);
  }
  const accounts = listAccounts({ kind: 'consumer', includeDisabled: true });
  const selected = accounts.find((entry) => entry.is_default);
  if (selected) return contextOf(selected, 'default', warnings);
  const enabled = accounts.filter((entry) => !entry.disabled);
  if (enabled.length === 1) return contextOf(enabled[0], 'auto-single', warnings);
  if (enabled.length > 1) {
    throw new PddCliError({ code: 'E_CONSUMER_ACCOUNT_REQUIRED',
      message: 'Multiple consumer accounts are registered but none was selected',
      hint: 'Use --consumer-account <nickname-or-phone>', exitCode: ExitCodes.USAGE });
  }
  if (needsAuth) throw missingAccount();
  return contextOf(null, null, warnings);
}

function missingAccount() {
  return new PddCliError({ code: 'E_CONSUMER_ACCOUNT_NOT_FOUND', message: 'Consumer account was not found',
    hint: 'Run pdd login --consumer to register the account again', exitCode: ExitCodes.USAGE });
}
