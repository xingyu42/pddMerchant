import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { platform } from 'node:os';
import { isPidAlive } from './process-util.js';
import { DAEMON_STATE_PATH, PROJECT_ROOT } from './paths.js';

const DAEMON_BIN = join(PROJECT_ROOT, 'bin', 'pdd-daemon.js');

async function readState() {
  if (!existsSync(DAEMON_STATE_PATH)) return null;
  try {
    return JSON.parse(await readFile(DAEMON_STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function spawnDaemonProcess() {
  if (platform() === 'win32') {
    const nodeBin = process.execPath.replace(/\\/g, '\\\\');
    const daemonBin = DAEMON_BIN.replace(/\\/g, '\\\\');
    const psCmd = `Start-Process -WindowStyle Hidden -FilePath '${nodeBin}' -ArgumentList '"${daemonBin}"'`;
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', psCmd], {
      windowsHide: true,
      stdio: 'ignore',
    });
    child.unref();
    return child.pid;
  }
  const child = spawn(process.execPath, [DAEMON_BIN], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child.pid;
}

export async function ensureDaemonRunning() {
  const state = await readState();
  if (state && typeof state.pid === 'number' && isPidAlive(state.pid)) {
    return { started: false, pid: state.pid };
  }
  await mkdir(dirname(DAEMON_STATE_PATH), { recursive: true });
  const childPid = spawnDaemonProcess();
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const s = await readState();
    if (s && s.status === 'running') {
      return { started: true, pid: s.pid ?? childPid };
    }
  }
  return { started: true, pid: childPid, confirmed: false };
}
