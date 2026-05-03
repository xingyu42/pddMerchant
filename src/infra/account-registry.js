import { readFile, writeFile, rename, cp, rm, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ACCOUNT_REGISTRY_PATH, ACCOUNTS_DIR, accountDir, accountAuthStatePath, AUTH_STATE_PATH, ensureDir } from './paths.js';
import { accountNotFound, accountAmbiguous, accountRegistryCorrupt } from './errors.js';
import { acquireLock, releaseLock } from '../adapter/auth-lock.js';

const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

const SLUG_RE = /^[a-z0-9一-鿿_-]{1,32}$/;

function emptyRegistry() {
  return { version: 1, defaultAccount: null, updatedAt: new Date().toISOString(), accounts: {} };
}

export function slugifyAccountName(displayName, { existingSlugs, mallId } = {}) {
  let slug = displayName.normalize('NFKC');
  slug = slug.toLowerCase();
  slug = slug.replace(/[^a-z0-9一-鿿_-]/g, '-');
  slug = slug.replace(/[-_]{2,}/g, '-');
  slug = slug.replace(/^[-_]+|[-_]+$/g, '');
  slug = slug.slice(0, 32);
  if (!slug) slug = 'account';
  if (WINDOWS_RESERVED.has(slug)) slug = `_${slug}`;
  if (existingSlugs instanceof Set && existingSlugs.has(slug)) {
    const hash = createHash('sha256')
      .update(`${displayName}:${mallId ?? ''}`)
      .digest('hex')
      .slice(0, 6);
    slug = `${slug.slice(0, 25)}-${hash}`;
  }
  return slug;
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
        await writeFile(path, JSON.stringify(reg, null, 2), 'utf8');
        return reg;
      }
      return null;
    }
    throw err;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) {
      throw new Error('schema mismatch');
    }
    if (!parsed.accounts || typeof parsed.accounts !== 'object') {
      parsed.accounts = {};
    }
    return parsed;
  } catch (e) {
    throw accountRegistryCorrupt(e.message);
  }
}

export async function saveAccountRegistry(registry, { path = ACCOUNT_REGISTRY_PATH } = {}) {
  registry.updatedAt = new Date().toISOString();
  const tmp = `${path}.tmp-${randomUUID().slice(0, 8)}`;
  await ensureDir(dirname(path));
  await writeFile(tmp, JSON.stringify(registry, null, 2), 'utf8');
  await rename(tmp, path);
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

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

export async function migrateLegacyToDefaultAccount({ warnings = [], path = ACCOUNT_REGISTRY_PATH } = {}) {
  const reg = await loadAccountRegistry({ path, createIfMissing: true });
  if (Object.keys(reg.accounts).length > 0) return false;

  const legacyPath = AUTH_STATE_PATH;
  if (!(await fileExists(legacyPath))) return false;

  let raw;
  try {
    raw = await readFile(legacyPath, 'utf8');
    JSON.parse(raw);
  } catch {
    return false;
  }

  const slug = 'default';
  const destDir = accountDir(slug);
  const destPath = accountAuthStatePath(slug);
  await ensureDir(destDir);
  await cp(legacyPath, destPath);

  const now = new Date().toISOString();
  reg.accounts[slug] = {
    slug,
    displayName: 'default',
    mallId: null,
    credential: null,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    lastRefreshAt: null,
    disabled: false,
    migratedFrom: 'legacy-auth-state',
  };
  reg.defaultAccount = slug;
  await saveAccountRegistry(reg, { path });

  warnings.push('auth_state_migrated_to_default_account');
  return true;
}
