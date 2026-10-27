import {
  DAEMON_LEASE, acquireDaemonLease, heartbeatDaemon, releaseDaemonLease,
  clearDaemonStopRequest, readDaemonStopRequest, purgeExpiredConsoleRows, clearDaemonMeta,
} from '../infra/daemon-state.js';
import { transaction } from '../infra/db.js';
import { createLogger, DailyRotatingFileDestination, resolveDefaultLogDirectory } from '../infra/logger.js';
import { cleanupOrphanBrowsers, closeAllBrowsers } from '../adapter/browser.js';
import { isMockEnabled } from '../adapter/mock-dispatcher.js';

export function daemonTimings() {
  const override = (key, fallback) => {
    const value = isMockEnabled() ? Number(process.env[key]) : NaN;
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  };
  return {
    ttlMs: override('PDD_TEST_DAEMON_LEASE_TTL_MS', DAEMON_LEASE.ttlMs),
    heartbeatMs: override('PDD_TEST_DAEMON_HEARTBEAT_MS', DAEMON_LEASE.heartbeatMs),
  };
}

function daemonLogger(foreground, runtimeConfig) {
  const file = foreground ? new DailyRotatingFileDestination(resolveDefaultLogDirectory({ channel: 'daemon' })) : null;
  const destination = file ? { write(chunk) { file.write(chunk); process.stderr.write(chunk); } } : undefined;
  const log = createLogger({ channel: 'daemon', destination, level: runtimeConfig?.logLevel });
  return { log, closeLog: () => { log.flush(); file?.end(); } };
}

export function createDaemonRuntime({ foreground = true, runtimeConfig } = {}) {
  const timings = daemonTimings();
  return {
    ...daemonLogger(foreground, runtimeConfig), timings,
    acquire: () => acquireDaemonLease(timings),
    heartbeat: (token) => heartbeatDaemon(token, timings),
    release: (token) => releaseDaemonLease(token, { clearStop: true }),
    clearStop: () => transaction(() => { clearDaemonStopRequest(); clearDaemonMeta('daemon_console_url'); }),
    stopRequested: readDaemonStopRequest,
    purge: purgeExpiredConsoleRows,
    cleanupBrowsers: cleanupOrphanBrowsers,
    closeBrowsers: closeAllBrowsers,
  };
}
