import { platform } from 'node:os';
import { execSync } from 'node:child_process';

export function isPidAlive(pid) {
  if (typeof pid !== 'number' || pid <= 0) return false;
  if (platform() === 'win32') {
    try {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf8', timeout: 5000 });
      return out.includes(String(pid));
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
