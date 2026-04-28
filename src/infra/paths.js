import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = join(__dirname, '..', '..');
export const DATA_DIR = join(PROJECT_ROOT, 'data');
export const CONFIG_DIR = join(PROJECT_ROOT, 'config');

function resolveDefaultAuthStatePath() {
  const authEnv = process.env.PDD_AUTH_STATE_PATH;
  if (authEnv && authEnv.length > 0) return authEnv;

  try {
    const home = homedir();
    if (platform() === 'win32') {
      const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
      return join(appData, 'pdd-cli', 'auth-state.json');
    }
    return join(home, '.pdd-cli', 'auth-state.json');
  } catch {
    return join(DATA_DIR, 'auth-state.json');
  }
}

export const AUTH_STATE_PATH = resolveDefaultAuthStatePath();
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

function resolveDefaultDaemonStatePath() {
  try {
    const home = homedir();
    if (platform() === 'win32') {
      const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
      return join(appData, 'pdd-cli', 'daemon-state.json');
    }
    return join(home, '.pdd-cli', 'daemon-state.json');
  } catch {
    return join(DATA_DIR, 'daemon-state.json');
  }
}

function resolveDefaultDaemonLogPath() {
  try {
    const home = homedir();
    if (platform() === 'win32') {
      const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
      return join(appData, 'pdd-cli', 'daemon.log');
    }
    return join(home, '.pdd-cli', 'daemon.log');
  } catch {
    return join(DATA_DIR, 'daemon.log');
  }
}

export const DAEMON_STATE_PATH = resolveDefaultDaemonStatePath();
export const DAEMON_LOG_PATH = resolveDefaultDaemonLogPath();

export async function ensureDir(path) {
  await mkdir(path, { recursive: true });
  return path;
}
