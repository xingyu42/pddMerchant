// Fixture mock 核心（design D-4）：ENV seam、fixtureDir 解析、唯一 cache Map。
// cache 单例仅存在于本模块 —— providers 一律经此读写，clearFixtureCache 清空即全清。
import { existsSync, readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { PROJECT_ROOT } from '../../infra/paths.js';

export const ENV_ENABLED = 'PDD_TEST_ADAPTER';
export const ENV_FIXTURE_DIR = 'PDD_TEST_FIXTURE_DIR';
export const ENV_AUTH_INVALID = 'PDD_TEST_AUTH_INVALID';
export const ENV_CONSUMER_AUTH_INVALID = 'PDD_TEST_CONSUMER_AUTH_INVALID';

export function isMockEnabled() {
  return process.env[ENV_ENABLED] === 'fixture';
}

function fixtureDir() {
  const override = process.env[ENV_FIXTURE_DIR];
  if (override && override.length > 0) {
    return isAbsolute(override) ? override : join(PROJECT_ROOT, override);
  }
  return join(PROJECT_ROOT, 'test', 'fixtures');
}

const cache = new Map();

export function loadFixture(relPath) {
  const full = join(fixtureDir(), relPath);
  if (cache.has(full)) return cache.get(full);
  if (!existsSync(full)) {
    throw new PddCliError({
      code: 'E_FIXTURE_MISSING',
      message: `mock adapter: fixture not found at ${full}`,
      hint: `确认 ${ENV_FIXTURE_DIR} 与 fixture 文件名`,
      exitCode: ExitCodes.GENERAL,
    });
  }
  const raw = readFileSync(full, 'utf8');
  const parsed = JSON.parse(raw);
  cache.set(full, parsed);
  return parsed;
}

export function clearFixtureCache() {
  cache.clear();
}
