import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const binPath = fileURLToPath(new URL('../../bin/pdd.js', import.meta.url));

export function spawnDaemonProcess() {
  const child = spawn(process.execPath, [binPath, 'daemon', 'run'], {
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
