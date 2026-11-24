import { hostname } from 'node:os';
import {
  readDaemonLease, requestDaemonStop, readDaemonOwnerToken, withDaemonLeaseOwner,
  deleteDaemonLease, getDaemonMeta, clearDaemonMeta,
} from '../infra/daemon-state.js';
import { transaction } from '../infra/db.js';
import { abortableSleep } from '../infra/abort.js';
import { daemonStartTimeout, daemonStopTimeout } from '../infra/errors.js';
import { spawnDaemonProcess, killDaemonProcess } from '../adapter/daemon-process.js';
import { toDaemonStatusView, toDaemonStartView, toDaemonStopView, toDaemonRestartView } from './views/daemon.js';

export function daemonIsRunning() {
  return readDaemonLease()?.running === true;
}

export function getDaemonStatus(runtimeConfig) {
  return toDaemonStatusView(readDaemonLease(), {
    lastPatrolAt: getDaemonMeta('daemon_last_patrol_at'),
    consoleUrl: getDaemonMeta('daemon_console_url'),
    patrolEnabled: runtimeConfig?.patrolEnabled,
  });
}

async function pollLease(predicate, intervalMs, timeoutMs, signal, clock) {
  const now = () => (clock?.now ? clock.now() : Date.now());
  const sleep = (ms, sig) => (clock?.sleep ? clock.sleep(ms, sig) : abortableSleep(ms, sig));
  const deadline = now() + timeoutMs;
  while (true) {
    const lease = readDaemonLease();
    if (predicate(lease)) return true;
    if (now() >= deadline) return false;
    await sleep(Math.min(intervalMs, deadline - now()), signal);
  }
}

export async function startDaemon({ signal, runtimeConfig, runtime, clock } = {}) {
  const activeClock = clock ?? runtime?.clock;
  const started = transaction(() => {
    if (daemonIsRunning()) return false;
    clearDaemonMeta('daemon_console_url');
    return true;
  });
  if (started) {
    if (runtime?.ports?.daemonProcess) runtime.ports.daemonProcess.spawnDetached({ env: runtime.rawEnv });
    else spawnDaemonProcess();
  }
  if (!await pollLease((lease) => lease?.running && Boolean(getDaemonMeta('daemon_console_url')), 200, 10_000, signal, activeClock)) {
    throw daemonStartTimeout();
  }
  return toDaemonStartView(getDaemonStatus(runtimeConfig), started);
}

function forceStop(token, runtime) {
  return withDaemonLeaseOwner(token, () => {
    const lease = readDaemonLease();
    if (!lease?.running) return toDaemonStopView(true);
    if (lease.hostname !== hostname()) throw daemonStopTimeout({ reason: 'foreign_host' });
    if (!Number.isSafeInteger(lease.pid) || lease.pid <= 0 || lease.pid === process.pid) {
      throw daemonStopTimeout({ reason: 'kill_failed' });
    }
    if (runtime?.ports?.daemonProcess) {
      runtime.ports.daemonProcess.stopByPid(lease.pid);
    } else {
      try { killDaemonProcess(lease.pid); }
      catch (error) {
        if (error?.code !== 'ESRCH') throw daemonStopTimeout({ pid: lease.pid, reason: 'kill_failed' });
      }
    }
    if (deleteDaemonLease(token)) clearDaemonMeta('daemon_console_url');
    return toDaemonStopView(true, true);
  });
}

export async function stopDaemon({ signal, runtime, clock } = {}) {
  const activeClock = clock ?? runtime?.clock;
  if (!daemonIsRunning()) return toDaemonStopView(false);
  const token = readDaemonOwnerToken();
  requestDaemonStop();
  if (await pollLease((lease) => !lease?.running, 500, 15_000, signal, activeClock)) return toDaemonStopView(true);
  const result = forceStop(token, runtime);
  if (!result) throw daemonStopTimeout({ reason: 'lease_active' });
  return result;
}

// 停止后再启动，让常驻进程加载磁盘上的新代码；未运行时等同 start。
export async function restartDaemon(options = {}) {
  const stopped = await stopDaemon(options);
  return toDaemonRestartView(await startDaemon(options), stopped);
}
