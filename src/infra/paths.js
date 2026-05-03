import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = join(__dirname, '..', '..');
export const DATA_DIR = join(PROJECT_ROOT, 'data');
export const CONFIG_DIR = join(PROJECT_ROOT, 'config');

function resolveDefaultAuthStatePath() {
  const authEnv = process.env.PDD_AUTH_STATE_PATH;
  if (authEnv && authEnv.length > 0) return authEnv;
  return join(DATA_DIR, 'auth-state.json');
}

export const AUTH_STATE_PATH = resolveDefaultAuthStatePath();
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
export const DAEMON_STATE_PATH = join(DATA_DIR, 'daemon-state.json');
export const DAEMON_LOG_PATH = join(DATA_DIR, 'daemon.log');

export const ACCOUNTS_DIR = join(DATA_DIR, 'accounts');
export const ACCOUNT_REGISTRY_PATH = join(DATA_DIR, 'accounts.json');

const SAFE_SLUG_RE = /^[a-z0-9一-鿿_-]{1,32}$/;

function assertSafeSlug(slug) {
  if (!slug || !SAFE_SLUG_RE.test(slug)) {
    throw new Error(`Invalid account slug: "${slug}"`);
  }
  const resolved = resolve(ACCOUNTS_DIR, slug);
  const rel = relative(ACCOUNTS_DIR, resolved);
  if (rel.startsWith('..') || rel.includes('..')) {
    throw new Error(`Account slug escapes accounts directory: "${slug}"`);
  }
}

export function accountDir(slug) {
  assertSafeSlug(slug);
  return join(ACCOUNTS_DIR, slug);
}

export function accountAuthStatePath(slug) {
  assertSafeSlug(slug);
  return join(ACCOUNTS_DIR, slug, 'auth-state.json');
}

export async function ensureDir(path) {
  await mkdir(path, { recursive: true });
  return path;
}
