import { readFile, writeFile, rename, rm, chmod } from 'node:fs/promises';
import { platform } from 'node:os';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ACCOUNT_REGISTRY_PATH, accountDir, ensureDir } from './paths.js';
import { accountNotFound, accountAmbiguous, accountRegistryCorrupt } from './errors.js';
import { acquireLock, releaseLock } from './auth-lock.js';
import { SAFE_STORAGE_SLUG_RE, slugifyStorageName } from './path-slug.js';

const SLUG_RE = SAFE_STORAGE_SLUG_RE;

function emptyRegistry() {
  return { version: 1, defaultAccount: null, updatedAt: new Date().toISOString(), accounts: {} };
}

export function slugifyAccountName(displayName, { existingSlugs, mallId } = {}) {
  return slugifyStorageName(displayName, { existingSlugs, stableId: mallId });
}

export async function loadAccountRegistry({ path = ACCOUNT_REGISTRY_PATH, createIfMissing = false } = {}) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') {
      if (createIfMissing) {
        const reg = emptyRegistry();
        await ensureDir(dirname(path));
        await writeFile(path, JSON.stringify(reg, null, 2), { encoding: 'utf8', mode: 0o600 });
        if (platform() !== 'win32') {
          await chmod(path, 0o600).catch(() => {});
        }
        return reg;
      }
      return null;
    }
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw accountRegistryCorrupt(e.message);
  }
  if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) {
    throw accountRegistryCorrupt('schema mismatch');
  }
  if (!parsed.accounts || typeof parsed.accounts !== 'object') {
    parsed.accounts = {};
  }
  return parsed;
}

export async function saveAccountRegistry(registry, { path = ACCOUNT_REGISTRY_PATH } = {}) {
  registry.updatedAt = new Date().toISOString();
  const tmp = `${path}.tmp-${randomUUID().slice(0, 8)}`;
  await ensureDir(dirname(path));
  await writeFile(tmp, JSON.stringify(registry, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, path);
  if (platform() !== 'win32') {
    await chmod(path, 0o600).catch(() => {});
  }
}

async function withRegistryLock(fn, { path = ACCOUNT_REGISTRY_PATH } = {}) {
  const { token } = await acquireLock(path, { timeoutMs: 10_000, staleMs: 30_000 });
  try {
    return await fn();
  } finally {
    await releaseLock(path, token);
  }
}

export async function listAccounts({ includeDisabled = false, path } = {}) {
  const reg = await loadAccountRegistry({ path });
  if (!reg) return [];
  const accounts = Object.values(reg.accounts);
  if (includeDisabled) return accounts;
  return accounts.filter((a) => !a.disabled);
}

export async function getAccount(ref, { allowDisplayName = false, path } = {}) {
  const reg = await loadAccountRegistry({ path });
  if (!reg) throw accountNotFound(ref);

  if (reg.accounts[ref]) return reg.accounts[ref];

  if (allowDisplayName) {
    const matches = Object.values(reg.accounts).filter((a) => a.displayName === ref);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw accountAmbiguous(ref, matches.map((a) => a.slug));
  }

  throw accountNotFound(ref);
}

export async function findAccountByMallId(mallId, { path } = {}) {
  const registry = await loadAccountRegistry({ path });
  if (!registry || mallId == null) return null;
  return Object.values(registry.accounts).find((account) => String(account.mallId ?? '') === String(mallId)) ?? null;
}

export async function upsertAccount(input, { setDefault = false, path = ACCOUNT_REGISTRY_PATH } = {}) {
  if (!input.slug || !SLUG_RE.test(input.slug)) {
    throw accountRegistryCorrupt(`Invalid slug: "${input.slug}"`);
  }
  return withRegistryLock(async () => {
    const reg = await loadAccountRegistry({ path, createIfMissing: true });
    const now = new Date().toISOString();
    const existing = reg.accounts[input.slug];

    if (existing) {
      const merged = { ...existing, ...input, updatedAt: now };
      reg.accounts[input.slug] = merged;
    } else {
      reg.accounts[input.slug] = {
        slug: input.slug,
        displayName: input.displayName ?? input.slug,
        mallId: input.mallId ?? null,
        credential: input.credential ?? null,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: input.lastLoginAt ?? null,
        lastRefreshAt: null,
        disabled: false,
        migratedFrom: input.migratedFrom ?? null,
      };
    }

    if (setDefault) reg.defaultAccount = input.slug;
    await saveAccountRegistry(reg, { path });
    return reg.accounts[input.slug];
  }, { path });
}

export async function rekeyAccount(oldSlug, input, { setDefault = false, path = ACCOUNT_REGISTRY_PATH } = {}) {
  if (!input.slug || !SLUG_RE.test(input.slug)) {
    throw accountRegistryCorrupt('Invalid replacement slug');
  }
  return withRegistryLock(async () => {
    const registry = await loadAccountRegistry({ path, createIfMissing: true });
    const existing = registry.accounts[oldSlug];
    if (!existing) throw accountNotFound(oldSlug);
    if (oldSlug !== input.slug && registry.accounts[input.slug]) {
      throw accountRegistryCorrupt('Replacement slug already exists');
    }
    const now = new Date().toISOString();
    delete registry.accounts[oldSlug];
    registry.accounts[input.slug] = { ...existing, ...input, slug: input.slug, updatedAt: now };
    if (setDefault || registry.defaultAccount === oldSlug) registry.defaultAccount = input.slug;
    await saveAccountRegistry(registry, { path });
    return registry.accounts[input.slug];
  }, { path });
}

export async function removeAccount(slug, { removeFiles = false, path = ACCOUNT_REGISTRY_PATH } = {}) {
  return withRegistryLock(async () => {
    const reg = await loadAccountRegistry({ path });
    if (!reg || !reg.accounts[slug]) throw accountNotFound(slug);

    delete reg.accounts[slug];
    if (reg.defaultAccount === slug) reg.defaultAccount = null;
    await saveAccountRegistry(reg, { path });

    if (removeFiles) {
      await rm(accountDir(slug), { recursive: true, force: true }).catch(() => {});
    }
  }, { path });
}

export async function setDefaultAccount(slug, { path = ACCOUNT_REGISTRY_PATH } = {}) {
  return withRegistryLock(async () => {
    const reg = await loadAccountRegistry({ path });
    if (!reg || !reg.accounts[slug]) throw accountNotFound(slug);
    reg.defaultAccount = slug;
    await saveAccountRegistry(reg, { path });
  }, { path });
}
