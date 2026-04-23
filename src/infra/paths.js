import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 项目路径单一事实源。所有模块通过本文件获取路径，禁止用 homedir() + '.pdd-cli' 的老模式。
// DATA_DIR     runtime artifacts (auth-state.json, QR PNGs, cache)
// CONFIG_DIR   user-level config.json
export const PROJECT_ROOT = join(__dirname, '..', '..');
export const DATA_DIR = join(PROJECT_ROOT, 'data');
export const CONFIG_DIR = join(PROJECT_ROOT, 'config');

const authEnv = process.env.PDD_AUTH_STATE_PATH;
export const AUTH_STATE_PATH = authEnv && authEnv.length > 0
  ? authEnv
  : join(DATA_DIR, 'auth-state.json');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export async function ensureDir(path) {
  await mkdir(path, { recursive: true });
  return path;
}
