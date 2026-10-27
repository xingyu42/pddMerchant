import { getAccountById, getCredential, putCredential, deleteCredential } from '../infra/account-store.js';
import { aad, seal, open } from '../infra/secret-box.js';
import { getMasterKey } from '../infra/master-key.js';
import { PddCliError, ExitCodes, secretDecryptFailed } from '../infra/errors.js';

function credentialOperation(callback) {
  try { return callback(); }
  catch (error) {
    if (error instanceof PddCliError) throw error;
    throw new PddCliError({ code: 'E_AUTH_ACCOUNT_SAVE_FAILED', message: '密码凭据存储暂不可用', exitCode: ExitCodes.AUTH });
  }
}

function merchantAccount(accountId) {
  const account = getAccountById(accountId);
  if (!account || account.kind !== 'merchant') {
    throw new PddCliError({ code: 'E_ACCOUNT_NOT_FOUND', message: '商家账号不存在', exitCode: ExitCodes.USAGE });
  }
  return account;
}

function validText(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
}

export function savePasswordCredential(accountId, credential) {
  return credentialOperation(() => {
    const { loginName, password } = credential ?? {};
    if (!validText(loginName) || !validText(password)) {
      throw new PddCliError({ code: 'E_USAGE', message: '登录名和密码须为非空字符串，且长度至多 128 个字符', exitCode: ExitCodes.USAGE });
    }
    merchantAccount(accountId);
    getMasterKey();
    const sealed = seal({ v: 1, login_name: loginName, password }, aad('credentials', accountId));
    return putCredential(accountId, sealed);
  });
}

export function loadPasswordCredential(accountId) {
  return credentialOperation(() => {
    const account = merchantAccount(accountId);
    const row = getCredential(accountId);
    if (!row) return null;
    try {
      const value = open(row.password_sealed, aad('credentials', accountId));
      if (value?.v !== 1 || !validText(value.login_name) || !validText(value.password)) throw secretDecryptFailed();
      return { loginName: value.login_name, password: value.password };
    } catch (error) {
      if (error instanceof PddCliError && error.code !== 'E_SECRET_DECRYPT_FAILED') throw error;
      throw secretDecryptFailed({ slug: account.slug, kind: 'merchant', table: 'credentials' });
    }
  });
}

export function hasPasswordCredential(accountId) {
  return credentialOperation(() => {
    merchantAccount(accountId);
    return getCredential(accountId) !== null;
  });
}

export function deletePasswordCredential(accountId) {
  return credentialOperation(() => {
    merchantAccount(accountId);
    return deleteCredential(accountId);
  });
}
