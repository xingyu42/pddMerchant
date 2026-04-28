import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = join(__dirname, '..', '..');
export const DATA_DIR = join(PROJECT_ROOT, 'data');
export const CONFIG_DIR = join(PROJECT_ROOT, 'config');

function resolveDefaultAuthStatePath() {
  const authEnv = process.env.PDD_AUTH_STATE_PATH;
  if (authEnv && authEnv.length > 0) return authEnv;
  return join(DATA_DIR, 'auth-state.json');
}

export const AUTH_STATE_PATH = resolveDefaultAuthStatePath();
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
export const DAEMON_STATE_PATH = join(DATA_DIR, 'daemon-state.json');
export const DAEMON_LOG_PATH = join(DATA_DIR, 'daemon.log');

export async function ensureDir(path) {
  await mkdir(path, { recursive: true });
  return path;
}
