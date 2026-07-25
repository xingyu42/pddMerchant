import { readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { platform } from 'node:os';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONSUMER_ACCOUNT_REGISTRY_PATH, ensureDir } from './paths.js';
import { PddCliError, ExitCodes } from './errors.js';
import { acquireLock, releaseLock } from './auth-lock.js';
import { SAFE_STORAGE_SLUG_RE } from './path-slug.js';

function emptyRegistry() {
  return { version: 1, defaultAccount: null, updatedAt: new Date().toISOString(), accounts: {} };
}

function registryCorrupt(reason) {
  return new PddCliError({
    code: 'E_CONSUMER_ACCOUNT_REGISTRY_CORRUPT',
    message: 'Consumer account registry is corrupted or invalid',
    detail: { reason },
    exitCode: ExitCodes.GENERAL,
  });
}

async function withRegistryLock(fn, { path = CONSUMER_ACCOUNT_REGISTRY_PATH } = {}) {
  const { token } = await acquireLock(path, { timeoutMs: 10_000, staleMs: 30_000 });
  try {
    return await fn();
  } finally {
    await releaseLock(path, token);
  }
}

export async function loadConsumerAccountRegistry({
  path = CONSUMER_ACCOUNT_REGISTRY_PATH,
  createIfMissing = false,
} = {}) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
    if (!createIfMissing) return null;
    const registry = emptyRegistry();
    await saveConsumerAccountRegistry(registry, { path });
    return registry;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw registryCorrupt('invalid_json');
  }
  if (!parsed || parsed.version !== 1 || typeof parsed.accounts !== 'object') {
    throw registryCorrupt('schema_mismatch');
  }
  return parsed;
}

export async function saveConsumerAccountRegistry(registry, { path = CONSUMER_ACCOUNT_REGISTRY_PATH } = {}) {
  registry.updatedAt = new Date().toISOString();
  const tmpPath = `${path}.tmp-${randomUUID().slice(0, 8)}`;
  await ensureDir(dirname(path));
  await writeFile(tmpPath, JSON.stringify(registry, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(tmpPath, path);
  if (platform() !== 'win32') await chmod(path, 0o600).catch(() => {});
}

export async function listConsumerAccounts({ includeDisabled = false, path } = {}) {
  const registry = await loadConsumerAccountRegistry({ path });
  if (!registry) return [];
  const accounts = Object.values(registry.accounts);
  return includeDisabled ? accounts : accounts.filter((account) => !account.disabled);
}

export async function getConsumerAccount(ref, { allowDisplayName = false, path } = {}) {
  const registry = await loadConsumerAccountRegistry({ path });
  if (!registry) return null;
  if (registry.accounts[ref]) return registry.accounts[ref];
  if (!allowDisplayName) return null;
  const matches = Object.values(registry.accounts).filter((account) => account.displayName === ref);
  return matches.length === 1 ? matches[0] : null;
}

export async function findConsumerAccountByUid(uid, { path } = {}) {
  const registry = await loadConsumerAccountRegistry({ path });
  if (!registry || uid == null) return null;
  return Object.values(registry.accounts).find((account) => String(account.uid) === String(uid)) ?? null;
}

export async function upsertConsumerAccount(input, {
  setDefault = false,
  path = CONSUMER_ACCOUNT_REGISTRY_PATH,
} = {}) {
  if (!input.slug || !SAFE_STORAGE_SLUG_RE.test(input.slug)) throw registryCorrupt('invalid_slug');
  return withRegistryLock(async () => {
    const registry = await loadConsumerAccountRegistry({ path, createIfMissing: true });
    const now = new Date().toISOString();
    const existing = registry.accounts[input.slug];
    registry.accounts[input.slug] = existing
      ? { ...existing, ...input, updatedAt: now }
      : {
          slug: input.slug,
          displayName: input.displayName ?? input.slug,
          uid: String(input.uid),
          createdAt: now,
          updatedAt: now,
          lastLoginAt: input.lastLoginAt ?? null,
          lastUsedAt: input.lastUsedAt ?? null,
          disabled: false,
        };
    if (setDefault) registry.defaultAccount = input.slug;
    await saveConsumerAccountRegistry(registry, { path });
    return registry.accounts[input.slug];
  }, { path });
}

export async function rekeyConsumerAccount(oldSlug, input, {
  setDefault = false,
  path = CONSUMER_ACCOUNT_REGISTRY_PATH,
} = {}) {
  if (!input.slug || !SAFE_STORAGE_SLUG_RE.test(input.slug)) throw registryCorrupt('invalid_slug');
  return withRegistryLock(async () => {
    const registry = await loadConsumerAccountRegistry({ path, createIfMissing: true });
    const existing = registry.accounts[oldSlug];
    if (!existing) throw registryCorrupt('account_missing');
    if (oldSlug !== input.slug && registry.accounts[input.slug]) throw registryCorrupt('slug_exists');
    delete registry.accounts[oldSlug];
    registry.accounts[input.slug] = {
      ...existing,
      ...input,
      slug: input.slug,
      updatedAt: new Date().toISOString(),
    };
    if (setDefault || registry.defaultAccount === oldSlug) registry.defaultAccount = input.slug;
    await saveConsumerAccountRegistry(registry, { path });
    return registry.accounts[input.slug];
  }, { path });
}
