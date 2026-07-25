import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PddCliError, ExitCodes } from './errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = join(__dirname, '..', '..');
export const DATA_DIR = join(PROJECT_ROOT, 'data');
export const MERCHANT_DATA_DIR = join(DATA_DIR, 'merchant');
export const CONSUMER_DATA_DIR = join(DATA_DIR, 'consumer');
export const CONFIG_DIR = join(PROJECT_ROOT, 'config');
export const LOG_DIR = join(PROJECT_ROOT, 'log');
export const CLI_LOG_DIR = join(LOG_DIR, 'cli');
export const DAEMON_LOG_DIR = join(LOG_DIR, 'daemon');

export const CONFIG_EXAMPLE_PATH = join(CONFIG_DIR, 'config.example.json');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
export const DAEMON_STATE_PATH = join(DATA_DIR, 'daemon-state.json');
// Daily files: log/cli/YYYY-MM-DD.log and log/daemon/YYYY-MM-DD.log
export const SCRAPE_COOLDOWN_PATH = join(DATA_DIR, 'scrape-cooldown.json');
export const GOODS_PUBLISH_SOURCE_CACHE_DIR = join(PROJECT_ROOT, 'tmp', 'goods-publish-source-cache');

function resolveDefaultAccountsDir() {
  const accountsDirEnv = process.env.PDD_ACCOUNTS_DIR;
  if (accountsDirEnv && accountsDirEnv.length > 0) return resolve(accountsDirEnv);
  return join(MERCHANT_DATA_DIR, 'stores');
}

function resolveDefaultAccountRegistryPath() {
  const registryEnv = process.env.PDD_ACCOUNT_REGISTRY_PATH;
  if (registryEnv && registryEnv.length > 0) return resolve(registryEnv);
  return join(resolveDefaultAccountsDir(), 'registry.json');
}

export const ACCOUNTS_DIR = resolveDefaultAccountsDir();
export const ACCOUNT_REGISTRY_PATH = resolveDefaultAccountRegistryPath();
export const AUTH_STATE_PATH = join(ACCOUNTS_DIR, 'default', 'auth-state.json');

function resolveDefaultConsumerAccountsDir() {
  const accountsDirEnv = process.env.PDD_CONSUMER_ACCOUNTS_DIR;
  if (accountsDirEnv && accountsDirEnv.length > 0) return resolve(accountsDirEnv);
  return join(CONSUMER_DATA_DIR, 'accounts');
}

function resolveDefaultConsumerAccountRegistryPath() {
  const registryEnv = process.env.PDD_CONSUMER_ACCOUNT_REGISTRY_PATH;
  if (registryEnv && registryEnv.length > 0) return resolve(registryEnv);
  return join(resolveDefaultConsumerAccountsDir(), 'registry.json');
}

export const CONSUMER_ACCOUNTS_DIR = resolveDefaultConsumerAccountsDir();
export const CONSUMER_ACCOUNT_REGISTRY_PATH = resolveDefaultConsumerAccountRegistryPath();

const SAFE_SLUG_RE = /^[a-z0-9一-鿿_-]{1,32}$/;

function assertSafeSlug(slug) {
  if (!slug || !SAFE_SLUG_RE.test(slug)) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: `Invalid account slug: "${slug}"`,
      hint: 'Slug must match /^[a-z0-9一-鿿_-]{1,32}$/',
      exitCode: ExitCodes.USAGE,
    });
  }
  const resolved = resolve(ACCOUNTS_DIR, slug);
  const rel = relative(ACCOUNTS_DIR, resolved);
  if (rel.startsWith('..') || rel.includes('..')) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: `Account slug escapes accounts directory: "${slug}"`,
      exitCode: ExitCodes.USAGE,
    });
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

export function merchantPendingAuthStatePath(token) {
  return join(ACCOUNTS_DIR, '_pending', `${token}.json`);
}

export async function ensureDir(path) {
  await mkdir(path, { recursive: true });
  return path;
}

function resolveDefaultConsumerAuthStatePath() {
  const authEnv = process.env.PDD_CONSUMER_AUTH_STATE_PATH;
  if (authEnv && authEnv.length > 0) return authEnv;
  return consumerAccountAuthStatePath('default');
}

export const CONSUMER_AUTH_STATE_PATH = resolveDefaultConsumerAuthStatePath();

export function consumerAccountDir(slug) {
  if (!slug || !SAFE_SLUG_RE.test(slug)) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: 'Invalid consumer account slug',
      hint: 'Consumer account slug contains unsupported characters',
      exitCode: ExitCodes.USAGE,
    });
  }
  const resolved = resolve(CONSUMER_ACCOUNTS_DIR, slug);
  const rel = relative(CONSUMER_ACCOUNTS_DIR, resolved);
  if (rel.startsWith('..') || rel.includes('..')) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: 'Consumer account slug escapes accounts directory',
      exitCode: ExitCodes.USAGE,
    });
  }
  return resolved;
}

export function consumerAccountAuthStatePath(slug) {
  return join(consumerAccountDir(slug), 'auth-state.json');
}

export function consumerPendingAuthStatePath(token) {
  return join(CONSUMER_ACCOUNTS_DIR, '_pending', `${token}.json`);
}
