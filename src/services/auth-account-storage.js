import { copyFile, rename, unlink, rmdir, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import {
  ensureDir,
  accountAuthStatePath,
  consumerAccountAuthStatePath,
  ACCOUNT_REGISTRY_PATH,
} from '../infra/paths.js';
import {
  findAccountByMallId,
  loadAccountRegistry,
  slugifyAccountName,
  upsertAccount,
} from '../infra/account-registry.js';
import {
  findConsumerAccountByUid,
  loadConsumerAccountRegistry,
  rekeyConsumerAccount,
  upsertConsumerAccount,
} from '../infra/consumer-account-registry.js';
import { slugifyStorageName } from '../infra/path-slug.js';
import { acquireLock, releaseLock, assertLockOwner } from '../infra/auth-lock.js';
import { getAuthStateRevision, deleteAuthState } from '../adapter/auth-state.js';
import { withMerchantAuthUpdate, commitMerchantCandidate, assertAuthTask } from '../adapter/merchant-auth-storage.js';
import { assertVerifiedMerchantCandidate } from '../adapter/merchant-auth.js';
import { isMockEnabled } from '../adapter/mock-dispatcher.js';
import { budgetMs } from '../infra/abort.js';

function provisioningError(kind, reason) {
  return new PddCliError({
    code: `E_${kind.toUpperCase()}_IDENTITY_INVALID`,
    message: kind === 'merchant' ? '无法识别当前店铺' : '无法识别消费者账号',
    hint: '重新登录后重试',
    detail: { reason },
    exitCode: ExitCodes.AUTH,
  });
}

async function stageAuthFile(sourcePath, targetPath) {
  if (sourcePath === targetPath) return false;
  await ensureDir(dirname(targetPath));
  const tmpPath = `${targetPath}.${randomUUID().slice(0, 8)}.tmp`;
  await copyFile(sourcePath, tmpPath);
  await rename(tmpPath, targetPath);
  return true;
}

async function removeSourceAfterCommit(sourcePath, targetPath) {
  if (sourcePath === targetPath) return;
  await unlink(sourcePath).catch((err) => {
    if (err?.code !== 'ENOENT') throw err;
  });
}

async function removeRekeyedAuthFile(oldPath, newPath) {
  if (!oldPath || oldPath === newPath) return;
  await unlink(oldPath).catch((err) => {
    if (err?.code !== 'ENOENT') throw err;
  });
  await rmdir(dirname(oldPath)).catch((err) => {
    if (!['ENOENT', 'ENOTEMPTY'].includes(err?.code)) throw err;
  });
}

// fixture 模式不登记账号，直接执行 fn（无 initialRevisions / registryToken）。
export async function withMerchantLoginRegistration(fn, task = {}) {
  if (isMockEnabled()) return fn({});
  assertAuthTask(task);
  const lockPath = ACCOUNT_REGISTRY_PATH;
  let lock;
  try {
    lock = await acquireLock(lockPath, { signal: task.signal, timeoutMs: budgetMs(task, 15000) });
    assertAuthTask(task);
    const registry = await loadAccountRegistry();
    const initialRevisions = new Map(await Promise.all(Object.values(registry?.accounts ?? {}).map(
      async (account) => [account.slug, await getAuthStateRevision(accountAuthStatePath(account.slug))],
    )));
    return await fn({ initialRevisions, registryToken: lock.token });
  } catch (error) {
    if (error instanceof PddCliError) throw error;
    throw new PddCliError({ code: 'E_AUTH_ACCOUNT_SAVE_FAILED', message: '商家账号登记未完成', exitCode: ExitCodes.AUTH });
  } finally { if (lock) await releaseLock(lockPath, lock.token); }
}

export async function provisionMerchantAuth(sourcePath, identity, { candidate, initialRevisions, registryToken, signal, deadlineAt } = {}) {
  assertVerifiedMerchantCandidate(candidate);
  if (registryToken) await assertLockOwner(ACCOUNT_REGISTRY_PATH, registryToken);
  if (String(identity?.mallId ?? '') !== candidate.identity.mallId) {
    throw new PddCliError({ code: 'E_ACCOUNT_IDENTITY_MISMATCH', message: '账号登记身份与已验证材料不一致', exitCode: ExitCodes.AUTH });
  }
  const mallId = candidate.identity.mallId;
  const displayName = candidate.identity.displayName;
  if (!mallId) throw provisioningError('merchant', 'mall_id_missing');
  if (!displayName) throw provisioningError('merchant', 'display_name_missing');

  const registry = await loadAccountRegistry() ?? { accounts: {} };
  const existing = await findAccountByMallId(mallId);
  const existingSlugs = new Set(Object.keys(registry.accounts));
  if (existing) existingSlugs.delete(existing.slug);
  const slug = existing?.slug ?? slugifyAccountName(displayName, { existingSlugs, mallId });
  const targetPath = accountAuthStatePath(slug);
  const input = {
    slug,
    displayName,
    mallId,
    lastLoginAt: new Date().toISOString(),
  };

  let account;
  const canonicalTarget = await realpath(targetPath).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (canonicalTarget && await realpath(sourcePath) === canonicalTarget) {
    assertAuthTask({ signal, deadlineAt });
    account = await upsertAccount(input, { setDefault: Object.keys(registry.accounts).length === 0, lockToken: registryToken });
  } else {
    account = await withMerchantAuthUpdate(targetPath, async (transaction) => {
      const expectedRevision = existing ? initialRevisions?.get(existing.slug) : null;
      if (existing && !initialRevisions?.has(existing.slug)) {
        throw new PddCliError({ code: 'E_AUTH_STATE_CONFLICT', message: '目标账号不是本次任务开始时的账号版本', exitCode: ExitCodes.AUTH });
      }
      if (registryToken) await assertLockOwner(ACCOUNT_REGISTRY_PATH, registryToken);
      await commitMerchantCandidate(candidate, transaction, { expectedRevision });
      const savedRevision = transaction.revision;
      try {
        assertAuthTask(transaction);
        return await upsertAccount(input, { setDefault: Object.keys(registry.accounts).length === 0, lockToken: registryToken });
      } catch (error) {
        if (!existing && await getAuthStateRevision(transaction.path) === savedRevision) await deleteAuthState(transaction.path);
        throw error;
      }
    }, { signal, deadlineAt, recoveryMallId: existing?.mallId });
    await removeSourceAfterCommit(sourcePath, targetPath);
  }
  return { account, authPath: targetPath };
}

export async function provisionConsumerAuth(sourcePath, identity) {
  const uid = identity?.uid == null ? '' : String(identity.uid);
  const displayName = typeof identity?.nickname === 'string' ? identity.nickname.trim() : '';
  if (!uid) throw provisioningError('consumer', 'uid_missing');
  if (!displayName) throw provisioningError('consumer', 'nickname_missing');

  const registry = await loadConsumerAccountRegistry({ createIfMissing: true });
  const existing = await findConsumerAccountByUid(uid);
  const existingSlugs = new Set(Object.keys(registry.accounts));
  if (existing) existingSlugs.delete(existing.slug);
  const slug = slugifyStorageName(displayName, { existingSlugs, stableId: uid });
  const targetPath = consumerAccountAuthStatePath(slug);
  const staged = await stageAuthFile(sourcePath, targetPath);
  const input = {
    slug,
    displayName,
    uid,
    lastLoginAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  };

  const account = existing && existing.slug !== slug
    ? await rekeyConsumerAccount(existing.slug, input, { setDefault: true })
    : await upsertConsumerAccount(input, { setDefault: true });
  if (staged) await removeSourceAfterCommit(sourcePath, targetPath);
  if (existing && existing.slug !== slug) {
    await removeRekeyedAuthFile(consumerAccountAuthStatePath(existing.slug), targetPath);
  }
  return { account, authPath: targetPath };
}
