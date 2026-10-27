import { transaction } from '../infra/db.js';
import { listAccounts, getAccountById, findAccountByIdentity, insertAccount, updateAccount, setDefaultAccount } from '../infra/account-store.js';
import { assertLeaseOwner } from '../infra/leases.js';
import { getMasterKey } from '../infra/master-key.js';
import { loadAuthState, getAuthStateRevision, saveAuthStateSnapshot, authStateConflict } from '../adapter/auth-state.js';
import { withMerchantAuthUpdate, merchantCandidateState, assertAuthTask } from '../adapter/merchant-auth-storage.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { assertVerifiedMerchantCandidate } from '../adapter/merchant-auth.js';

function provisioningError(kind, reason) {
  return new PddCliError({
    code: `E_${kind.toUpperCase()}_IDENTITY_INVALID`,
    message: kind === 'merchant' ? '无法识别当前店铺' : '无法识别消费者账号',
    hint: '重新登录后重试', detail: { reason }, exitCode: ExitCodes.AUTH,
  });
}

function saveMerchantLogin(result, initial, task) {
  assertAuthTask(task);
  assertVerifiedMerchantCandidate(result?.candidate);
  // 主密钥指纹先独立确认，账号提交回滚时仍保留加密库的密钥标识。
  getMasterKey();
  return transaction(() => {
    assertAuthTask(task);
    if (initial) {
      assertLeaseOwner('account', initial.accountId, initial.token);
      if (!getAccountById(initial.accountId)) throw authStateConflict();
    }
    const candidate = result.candidate;
    const state = merchantCandidateState(candidate, initial ?? {});
    const identity = candidate.identity;
    if (String(result.identity?.mallId ?? '') !== identity.mallId) {
      throw new PddCliError({ code: 'E_ACCOUNT_IDENTITY_MISMATCH', message: '账号登记身份与已验证材料不一致', exitCode: ExitCodes.AUTH });
    }
    if (!identity.mallId || !identity.displayName) throw provisioningError('merchant', 'identity_missing');
    let account = findAccountByIdentity('merchant', identity.mallId);
    if (initial && (account?.id !== initial.accountId || getAuthStateRevision(account.id) !== initial.revision)) {
      throw authStateConflict();
    }
    if (!account) {
      account = insertAccount({ identity: identity.mallId, displayName: identity.displayName },
        { setDefault: listAccounts({ includeDisabled: true }).length === 0 });
    }
    const loaded = initial ?? loadAuthState(account.id, { allowCorrupt: true });
    merchantCandidateState(candidate, { state: loaded.state, recoveryMallId: account.identity });
    saveAuthStateSnapshot(state, account.id, { expectedRevision: initial?.revision ?? loaded.revision });
    account = updateAccount(account.id, { displayName: identity.displayName, lastLoginAt: new Date().toISOString() });
    return { account, accountId: account.id, result };
  });
}

// 浏览器回调在事务外执行；最终登记和保存只持有短事务。
export async function provisionMerchantLogin(login, { accountId, ...task } = {}) {
  try {
    assertAuthTask(task);
    if (accountId != null) {
      const account = getAccountById(accountId);
      if (!account || account.kind !== 'merchant') throw authStateConflict();
      return await withMerchantAuthUpdate(accountId, async (initial) => {
        const result = await login(initial);
        return saveMerchantLogin(result, initial, task);
      }, { ...task, recoveryMallId: account.identity });
    }
    const result = await login({ ...task, state: null, revision: 0 });
    return saveMerchantLogin(result, null, task);
  } catch (error) {
    if (error instanceof PddCliError) throw error;
    throw new PddCliError({ code: 'E_AUTH_ACCOUNT_SAVE_FAILED', message: '商家账号登记未完成', exitCode: ExitCodes.AUTH });
  }
}

export function provisionConsumerAuth(state, identity) {
  const uid = identity?.uid == null ? '' : String(identity.uid);
  const displayName = typeof identity?.nickname === 'string' ? identity.nickname.trim() : '';
  if (!uid) throw provisioningError('consumer', 'uid_missing');
  if (!displayName) throw provisioningError('consumer', 'nickname_missing');
  try {
    getMasterKey();
    return transaction(() => {
      const now = new Date().toISOString();
      const existing = findAccountByIdentity('consumer', uid);
      const account = existing
        ? updateAccount(existing.id, { displayName, lastLoginAt: now, lastUsedAt: now })
        : insertAccount({ kind: 'consumer', identity: uid, displayName, lastLoginAt: now, lastUsedAt: now });
      const selected = setDefaultAccount(account.slug, { kind: 'consumer' });
      saveAuthStateSnapshot(state, account.id);
      return { account: selected, accountId: account.id };
    });
  } catch (error) {
    if (error instanceof PddCliError) throw error;
    throw new PddCliError({ code: 'E_AUTH_ACCOUNT_SAVE_FAILED', message: '消费者账号登记未完成', exitCode: ExitCodes.AUTH });
  }
}
