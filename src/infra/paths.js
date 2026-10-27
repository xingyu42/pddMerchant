import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = join(__dirname, '..', '..');
export const DATA_DIR = join(PROJECT_ROOT, 'data');
export const DB_PATH = process.env.PDD_DB_PATH ? resolve(process.env.PDD_DB_PATH) : join(DATA_DIR, 'pdd.db');
export const CONFIG_DIR = join(PROJECT_ROOT, 'config');
export const LOG_DIR = join(PROJECT_ROOT, 'log');
export const CLI_LOG_DIR = join(LOG_DIR, 'cli');

export const CONFIG_EXAMPLE_PATH = join(CONFIG_DIR, 'config.example.json');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
// Daily files: log/cli/YYYY-MM-DD.log
export const SCRAPE_COOLDOWN_PATH = join(DATA_DIR, 'scrape-cooldown.json');
export const GOODS_PUBLISH_SOURCE_CACHE_DIR = join(PROJECT_ROOT, 'tmp', 'goods-publish-source-cache');

export async function ensureDir(path) {
  await mkdir(path, { recursive: true });
  return path;
}
