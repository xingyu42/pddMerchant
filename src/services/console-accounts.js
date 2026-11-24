import { getAccount, listAccounts, listPendingActions } from '../infra/account-store.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getAuthStateMetadata } from '../adapter/auth-state.js';
import { getReloginSummary, setAccountPassword, clearAccountPassword, clearReloginBlock } from './relogin-policy.js';
import { toConsoleAccountView } from './views/console.js';
import { getConsoleLinkView } from './console-auth.js';
import { removeAccountView } from './account-removal.js';
import { consoleRequestError } from './console-runtime.js';

export function consoleAccount(slug) {
  const account = getAccount(slug);
  if (!account) throw new PddCliError({ code: 'E_ACCOUNT_NOT_FOUND', message: '商家账号不存在', exitCode: ExitCodes.USAGE });
  return account;
}

export function listConsoleAccounts() {
  return { items: listAccounts().map((account) => toConsoleAccountView(account,
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

// 输入店铺名才删除；正在登录的店铺先取消登录，避免会话写回已删除的账号。
export function removeConsoleAccount(slug, body, { isAccountLoggingIn = () => false } = {}) {
  const account = consoleAccount(slug);
  const expected = account.display_name ?? account.slug;
  if (typeof body?.confirm_name !== 'string' || body.confirm_name.trim() !== expected) {
    throw consoleRequestError(400, 'E_USAGE', '店铺名不一致，未删除');
  }
  if (isAccountLoggingIn(account.id)) {
    throw consoleRequestError(409, 'E_CONSOLE_SESSION_STATE', '该店铺正在登录，请先取消登录');
  }
  removeAccountView(account.slug, { confirm: true });
  return { ok: true, removed: true };
}
