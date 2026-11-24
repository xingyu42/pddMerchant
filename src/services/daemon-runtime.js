import {
  DAEMON_LEASE, acquireDaemonLease, heartbeatDaemon, releaseDaemonLease,
  clearDaemonStopRequest, readDaemonStopRequest, purgeExpiredConsoleRows, clearDaemonMeta, daemonBrowserOwnerTag,
} from '../infra/daemon-state.js';
import { transaction } from '../infra/db.js';
import { createLogger, DailyRotatingFileDestination, resolveDefaultLogDirectory } from '../infra/logger.js';

export function daemonTimings(parsedEnv = null) {
  if (parsedEnv?.mode !== 'fixture') {
    return {
      ttlMs: DAEMON_LEASE.ttlMs,
      heartbeatMs: DAEMON_LEASE.heartbeatMs,
    };
  }
  const pick = (value, fallback) => (Number.isSafeInteger(value) && value > 0 ? value : fallback);
  return {
    ttlMs: pick(parsedEnv.daemonLeaseTtlMs, DAEMON_LEASE.ttlMs),
    heartbeatMs: pick(parsedEnv.daemonHeartbeatMs, DAEMON_LEASE.heartbeatMs),
  };
}

export function createDaemonLogger({ foreground = true, runtimeConfig } = {}) {
  const file = foreground ? new DailyRotatingFileDestination(resolveDefaultLogDirectory({ channel: 'daemon' })) : null;
  const destination = file ? { write(chunk) { file.write(chunk); process.stderr.write(chunk); } } : undefined;
  const log = createLogger({ channel: 'daemon', destination, level: runtimeConfig?.logLevel });
  return {
    log,
    closeLog: () => {
      log.flush();
      file?.end();
    },
  };
}

export function createDaemonLifecycleOps({ parsedEnv = null, browser, log, closeLog } = {}) {
  const timings = daemonTimings(parsedEnv);
  return {
    log,
    closeLog,
    timings,
    acquire: () => acquireDaemonLease(timings),
    ownerTag: daemonBrowserOwnerTag,
    heartbeat: (token) => heartbeatDaemon(token, timings),
    release: (token) => releaseDaemonLease(token, { clearStop: true }),
    clearStop: () => transaction(() => {
      clearDaemonStopRequest();
      clearDaemonMeta('daemon_console_url');
    }),
    stopRequested: readDaemonStopRequest,
    purge: purgeExpiredConsoleRows,
    cleanupBrowsers: () => browser.reclaimOrphans(),
    closeBrowsers: () => browser.closeAll(),
  };
}
