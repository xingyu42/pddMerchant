import { copyFile, rename, unlink, rmdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import {
  ensureDir,
  accountAuthStatePath,
  consumerAccountAuthStatePath,
} from '../infra/paths.js';
import {
  findAccountByMallId,
  loadAccountRegistry,
  rekeyAccount,
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

export async function provisionMerchantAuth(sourcePath, identity) {
  const mallId = identity?.mallId == null ? '' : String(identity.mallId);
  const displayName = typeof identity?.displayName === 'string' ? identity.displayName.trim() : '';
  if (!mallId) throw provisioningError('merchant', 'mall_id_missing');
  if (!displayName) throw provisioningError('merchant', 'display_name_missing');

  const registry = await loadAccountRegistry({ createIfMissing: true });
  const existing = await findAccountByMallId(mallId);
  const existingSlugs = new Set(Object.keys(registry.accounts));
  if (existing) existingSlugs.delete(existing.slug);
  const slug = slugifyAccountName(displayName, { existingSlugs, mallId });
  const targetPath = accountAuthStatePath(slug);
  const staged = await stageAuthFile(sourcePath, targetPath);
  const input = {
    slug,
    displayName,
    mallId,
    lastLoginAt: new Date().toISOString(),
  };

  const account = existing && existing.slug !== slug
    ? await rekeyAccount(existing.slug, input)
    : await upsertAccount(input, { setDefault: Object.keys(registry.accounts).length === 0 });
  if (staged) await removeSourceAfterCommit(sourcePath, targetPath);
  if (existing && existing.slug !== slug) {
    await removeRekeyedAuthFile(accountAuthStatePath(existing.slug), targetPath);
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
