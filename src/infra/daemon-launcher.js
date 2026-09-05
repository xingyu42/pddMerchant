import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { platform } from 'node:os';
import { isPidAlive } from './process-util.js';
import { DAEMON_STATE_PATH, PROJECT_ROOT } from './paths.js';

const DAEMON_BIN = join(PROJECT_ROOT, 'bin', 'pdd-daemon.js');
const DAEMON_START_LOCK = DAEMON_STATE_PATH + '.start.lock';

async function acquireStartLock() {
  await mkdir(dirname(DAEMON_START_LOCK), { recursive: true });
  const lockData = JSON.stringify({ pid: process.pid, createdAt: Date.now() });
  try {
    await writeFile(DAEMON_START_LOCK, lockData, { flag: 'wx', mode: 0o600 });
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    try {
      const raw = JSON.parse(await readFile(DAEMON_START_LOCK, 'utf8'));
      const stale = Date.now() - raw.createdAt > 30_000 || !isPidAlive(raw.pid);
      if (stale) {
        await unlink(DAEMON_START_LOCK).catch(() => {});
        try {
          await writeFile(DAEMON_START_LOCK, lockData, { flag: 'wx', mode: 0o600 });
          return true;
        } catch { return false; }
      }
    } catch {
      await unlink(DAEMON_START_LOCK).catch(() => {});
      try {
        await writeFile(DAEMON_START_LOCK, lockData, { flag: 'wx', mode: 0o600 });
        return true;
      } catch { return false; }
    }
    return false;
  }
}

async function releaseStartLock() {
  await unlink(DAEMON_START_LOCK).catch(() => {});
}

async function readState() {
  if (!existsSync(DAEMON_STATE_PATH)) return null;
  try {
    return JSON.parse(await readFile(DAEMON_STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function hasLivePid(state) {
  return Number.isSafeInteger(state?.pid) && state.pid > 0 && isPidAlive(state.pid);
}

function isRunningState(state) {
  return hasLivePid(state) && state.status === 'running'
    && typeof (state.tokenFingerprint || state.token) === 'string'
    && Boolean(state.tokenFingerprint || state.token);
}

function spawnDaemonProcess(startupAttempt) {
  const env = { ...process.env, PDD_DAEMON_STARTUP_ATTEMPT: startupAttempt };
  if (platform() === 'win32') {
    const nodeBin = process.execPath.replace(/\\/g, '\\\\');
    const daemonBin = DAEMON_BIN.replace(/\\/g, '\\\\');
    const psCmd = `Start-Process -WindowStyle Hidden -FilePath '${nodeBin}' -ArgumentList '"${daemonBin}"'`;
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', psCmd], {
      windowsHide: true,
      stdio: 'ignore',
      env,
    });
    child.once('error', () => {}); // The bounded state confirmation reports failed launches.
    child.unref();
    return child.pid;
  }
  const child = spawn(process.execPath, [DAEMON_BIN], {
    detached: true,
    stdio: 'ignore',
    env,
  });
  child.once('error', () => {});
  child.unref();
  return child.pid;
}

export async function ensureDaemonRunning() {
  const state = await readState();
  if (isRunningState(state)) {
    return { started: false, pid: state.pid };
  }
  if (hasLivePid(state)) return { started: false, confirmed: false };

  const acquired = await acquireStartLock();
  if (!acquired) {
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const s = await readState();
      if (isRunningState(s)) {
        return { started: false, pid: s.pid };
      }
    }
    return { started: false, confirmed: false };
  }

  try {
    const recheck = await readState();
    if (isRunningState(recheck)) {
      return { started: false, pid: recheck.pid };
    }
    if (hasLivePid(recheck)) return { started: false, confirmed: false };

    await mkdir(dirname(DAEMON_STATE_PATH), { recursive: true });
    const startupAttempt = randomUUID();
    const childPid = spawnDaemonProcess(startupAttempt);
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const s = await readState();
      if (isRunningState(s) && s.startupAttempt === startupAttempt) {
        return { started: true, pid: s.pid ?? childPid };
      }
    }
    return { started: true, pid: childPid, confirmed: false };
  } finally {
    await releaseStartLock();
  }
}
