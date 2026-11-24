import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { daemonStopTimeout } from '../infra/errors.js';

const binPath = fileURLToPath(new URL('../../bin/pdd.js', import.meta.url));

/** Create a Live DaemonProcessPort encapsulating detached spawn, PID termination and liveness checks. */
export function createLiveDaemonProcessPort({
  spawn = nodeSpawn,
  kill = process.kill,
  env,
  execPath = process.execPath,
  entryPath = binPath,
  selfPid = process.pid,
} = {}) {
  function spawnDetached({ env: extraEnv } = {}) {
    const baseEnv = env ?? process.env;
    const child = spawn(execPath, [entryPath, 'daemon', 'run'], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      env: { ...baseEnv, ...(extraEnv ?? {}) },
    });
    // Spawn failures are reported by the parent's bounded lease polling.
    child.once('error', () => {});
    child.unref();
    return { pid: Number.isSafeInteger(child?.pid) ? child.pid : null };
  }

  function stopByPid(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === selfPid) {
      throw daemonStopTimeout({ reason: 'kill_failed' });
    }
    try {
      kill(pid);
      return { stopped: true, alreadyExited: false };
    } catch (error) {
      if (error?.code === 'ESRCH') {
        return { stopped: true, alreadyExited: true };
      }
      throw daemonStopTimeout({ pid, reason: 'kill_failed' });
    }
  }

  function isRunning(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try {
      kill(pid, 0);
      return true;
    } catch (error) {
      return error?.code === 'EPERM';
    }
  }

  return Object.freeze({
    spawnDetached,
    stopByPid,
    isRunning,
  });
}

export function spawnDaemonProcess() {
  const child = nodeSpawn(process.execPath, [binPath, 'daemon', 'run'], {
    detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env },
  });
  // Spawn failures are reported by the parent's bounded lease polling.
  child.once('error', () => {});
  child.unref();
  return child;
}

export function killDaemonProcess(pid) {
  process.kill(pid);
}
