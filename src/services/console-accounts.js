import { getAccount, listAccounts, listPendingActions } from '../infra/account-store.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getAuthStateMetadata } from '../adapter/auth-state.js';
import { getReloginSummary, setAccountPassword, clearAccountPassword, clearReloginBlock } from './password-relogin.js';
import { toConsoleAccountView } from './views/console.js';
import { getConsoleLinkView } from './console-auth.js';

export function consoleAccount(slug) {
  const account = getAccount(slug);
  if (!account) throw new PddCliError({ code: 'E_ACCOUNT_NOT_FOUND', message: '商家账号不存在', exitCode: ExitCodes.USAGE });
  return account;
}

export function listConsoleAccounts() {
  return { items: listAccounts({ includeDisabled: true }).map((account) => toConsoleAccountView(account,
    getAuthStateMetadata(account.id), getReloginSummary(account.id), listPendingActions(account.id))) };
}

export function saveConsolePassword(slug, body) {
  try {
    setAccountPassword(consoleAccount(slug).id, { loginName: body?.login_name, password: body?.password });
    return { ok: true, has_password: true };
  } finally {
    if (body && typeof body === 'object') { delete body.login_name; delete body.password; }
  }
}

export function clearConsolePassword(slug) {
  clearAccountPassword(consoleAccount(slug).id);
  return { ok: true, has_password: false };
}

export function unblockConsoleAccount(slug) {
  clearReloginBlock(consoleAccount(slug).id);
  return { ok: true };
}

export function consoleLinkForAccount(slug) {
  return getConsoleLinkView({ accountId: slug ? consoleAccount(slug).id : null });
}
