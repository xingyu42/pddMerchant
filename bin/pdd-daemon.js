#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadRuntimeConfig } from '../src/infra/config.js';
import { createLogger } from '../src/infra/logger.js';
import { AUTH_STATE_PATH, DAEMON_STATE_PATH, DAEMON_LOG_PATH } from '../src/infra/paths.js';
import { refreshAuth } from '../src/adapter/auth-refresher.js';
import { closeAllBrowsers } from '../src/adapter/browser.js';
import { loadAccountRegistry, listAccounts, upsertAccount } from '../src/infra/account-registry.js';
import { accountAuthStatePath } from '../src/infra/paths.js';
import { decryptCredential, resolveMasterPassword, hasEncryptedCredential } from '../src/infra/credential-vault.js';
import { loginWithPassword } from '../src/adapter/password-login.js';

const token = randomUUID();
const tokenFingerprint = createHash('sha256').update(token).digest('hex').slice(0, 8);
let shuttingDown = false;
let abortController = new AbortController();
let refreshInProgress = false;
let currentRefreshPromise = null;
let refreshTimer = null;
let config;
let log;

const startedAt = new Date();
let refreshCount = 0;
let failureCount = 0;
const accountStates = {};

async function writeDaemonState(extra = {}) {
  const state = {
    pid: process.pid,
    token,
    startedAt: startedAt.toISOString(),
    status: 'running',
    lastRefreshAt: null,
    lastResult: null,
    nextRunAt: null,
    qrPngPath: null,
    refreshCount: 0,
    failureCount: 0,
    accounts: { ...accountStates },
    ...extra,
  };
  await mkdir(dirname(DAEMON_STATE_PATH), { recursive: true });
  const tmp = `${DAEMON_STATE_PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  const { rename } = await import('node:fs/promises');
  await rename(tmp, DAEMON_STATE_PATH);
}

async function readDaemonState() {
  try {
    return JSON.parse(await readFile(DAEMON_STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function computeDelay() {
  const base = config.refreshIntervalMs;
  const jitter = config.refreshJitterMs;
  const offset = Math.floor(Math.random() * 2 * jitter) - jitter;
  return Math.max(60_000, base + offset);
}

async function refreshSingleAccount(slug, authStatePath, account) {
  log.info({ slug }, 'refreshing account');
  const result = await refreshAuth({ authStatePath, log, signal: abortController.signal });

  if (result.success) {
    accountStates[slug] = {
      lastRefreshAt: new Date().toISOString(),
      lastResult: 'refreshed',
      lastLoginAt: accountStates[slug]?.lastLoginAt ?? null,
      failureCount: 0,
    };
    return;
  }

  if (hasEncryptedCredential(account)) {
    const masterPwd = resolveMasterPassword();
    if (masterPwd) {
      try {
        const plaintext = await decryptCredential(account.credential, masterPwd, { accountSlug: slug });
        await loginWithPassword({
          mobile: plaintext.mobile,
          password: plaintext.password,
          authStatePath,
          log,
        });
        const now = new Date().toISOString();
        accountStates[slug] = {
          lastRefreshAt: now,
          lastResult: 'auth_expired_relogin_success',
          lastLoginAt: now,
          failureCount: 0,
        };
        await upsertAccount({ slug, lastLoginAt: now }).catch(() => {});
        return;
      } catch (reloginErr) {
        log.warn({ slug, err: reloginErr?.message }, 'auto-relogin failed');
      }
    } else {
      log.warn({ slug }, 'no master password, skip auto-relogin');
    }
  }

  const prev = accountStates[slug] ?? {};
  accountStates[slug] = {
    lastRefreshAt: new Date().toISOString(),
    lastResult: result.reason ?? 'auth_expired',
    lastLoginAt: prev.lastLoginAt ?? null,
    failureCount: (prev.failureCount ?? 0) + 1,
  };
}

async function doRefresh() {
  if (refreshInProgress || shuttingDown) {
    log.debug('refresh skipped: already in progress or shutting down');
    return;
  }
  refreshInProgress = true;
  try {
    const accounts = await listAccounts().catch(() => []);

    if (accounts.length === 0) {
      const authStatePath = config.authStatePath || AUTH_STATE_PATH;
      log.info('no registered accounts, refreshing legacy auth');
      const result = await refreshAuth({ authStatePath, log, signal: abortController.signal });
      refreshCount++;
      if (!result.success) failureCount++;

      const stateUpdate = {
        lastRefreshAt: new Date().toISOString(),
        lastResult: result.reason,
        refreshCount,
        failureCount,
        qrPngPath: result.qrPngPath || null,
      };
      const nextDelay = computeDelay();
      stateUpdate.nextRunAt = new Date(Date.now() + nextDelay).toISOString();
      await writeDaemonState(stateUpdate);
      return nextDelay;
    }

    for (const account of accounts) {
      if (shuttingDown) break;
      try {
        const authPath = accountAuthStatePath(account.slug);
        await refreshSingleAccount(account.slug, authPath, account);
      } catch (err) {
        log.error({ slug: account.slug, err: err?.message }, 'account refresh error');
        const prev = accountStates[account.slug] ?? {};
        accountStates[account.slug] = {
          lastRefreshAt: new Date().toISOString(),
          lastResult: 'error',
          lastLoginAt: prev.lastLoginAt ?? null,
          failureCount: (prev.failureCount ?? 0) + 1,
        };
      }

      if (accounts.indexOf(account) < accounts.length - 1) {
        const jitter = 2000 + Math.floor(Math.random() * 3000);
        await new Promise((r) => setTimeout(r, jitter));
      }
    }

    refreshCount++;
    failureCount = Object.values(accountStates).reduce((sum, s) => sum + (s.failureCount ?? 0), 0);
    const nextDelay = computeDelay();
    await writeDaemonState({
      lastRefreshAt: new Date().toISOString(),
      lastResult: 'multi_account_refresh',
      refreshCount,
      failureCount,
      accounts: { ...accountStates },
      nextRunAt: new Date(Date.now() + nextDelay).toISOString(),
    });
    return nextDelay;
  } catch (err) {
    log.error({ err: err?.message }, 'refresh error');
    failureCount++;
    return computeDelay();
  } finally {
    refreshInProgress = false;
  }
}

function scheduleNext(delay) {
  if (shuttingDown) return;
  const d = delay ?? computeDelay();
  refreshTimer = setTimeout(async () => {
    currentRefreshPromise = doRefresh();
    const nextDelay = await currentRefreshPromise;
    currentRefreshPromise = null;
    scheduleNext(nextDelay);
  }, d);
}

async function gracefulShutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal: sig }, 'daemon shutting down');

  if (refreshTimer) clearTimeout(refreshTimer);
  abortController.abort();

  if (currentRefreshPromise) {
    try {
      await Promise.race([
        currentRefreshPromise,
        new Promise((r) => setTimeout(r, 10_000)),
      ]);
    } catch { /* ignore */ }
  }

  await closeAllBrowsers({ timeoutMs: 5000 }).catch(() => {});

  try {
    const state = await readDaemonState();
    if (state && state.token === token) {
      await writeDaemonState({
        status: 'stopped',
        lastRefreshAt: state.lastRefreshAt,
        lastResult: state.lastResult,
        nextRunAt: null,
        refreshCount,
        failureCount,
      });
    }
  } catch { /* best effort */ }

  process.exit(0);
}

async function main() {
  const isForeground = process.argv.includes('--foreground');

  config = await loadRuntimeConfig();
  log = createLogger({
    verbose: true,
    ...(isForeground ? {} : { destination: DAEMON_LOG_PATH }),
  });

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  await writeDaemonState();
  log.info({
    pid: process.pid,
    tokenFingerprint,
    refreshIntervalMs: config.refreshIntervalMs,
    refreshJitterMs: config.refreshJitterMs,
    foreground: isForeground,
  }, 'daemon started');

  currentRefreshPromise = doRefresh();
  const nextDelay = await currentRefreshPromise;
  currentRefreshPromise = null;
  scheduleNext(nextDelay);
}

main().catch((err) => {
  console.error('daemon fatal:', err?.message ?? err);
  process.exit(1);
});
