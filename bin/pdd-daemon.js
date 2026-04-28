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

async function doRefresh() {
  if (refreshInProgress || shuttingDown) {
    log.debug('refresh skipped: already in progress or shutting down');
    return;
  }
  refreshInProgress = true;
  try {
    const authStatePath = config.authStatePath || AUTH_STATE_PATH;
    log.info('starting auth refresh');
    const result = await refreshAuth({
      authStatePath,
      log,
      signal: abortController.signal,
    });

    refreshCount++;
    const stateUpdate = {
      lastRefreshAt: new Date().toISOString(),
      lastResult: result.reason,
      refreshCount,
      failureCount,
      qrPngPath: result.qrPngPath || null,
    };

    if (!result.success) {
      failureCount++;
      stateUpdate.failureCount = failureCount;
      log.warn({ reason: result.reason }, 'auth refresh failed');
    } else {
      log.info('auth refresh succeeded');
    }

    const nextDelay = computeDelay();
    stateUpdate.nextRunAt = new Date(Date.now() + nextDelay).toISOString();
    await writeDaemonState(stateUpdate);
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
