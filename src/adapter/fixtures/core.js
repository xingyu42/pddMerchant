// Fixture mock 核心：fixtureDir 解析与按实例持有的 FixtureStore。
import { existsSync, readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { PROJECT_ROOT } from '../../infra/paths.js';

const ENV_ENABLED = 'PDD_TEST_ADAPTER';
const ENV_FIXTURE_DIR = 'PDD_TEST_FIXTURE_DIR';

export function isMockEnabled(env = {}) {
  return env?.[ENV_ENABLED] === 'fixture';
}

function resolveFixtureDir(env = {}) {
  const override = env?.[ENV_FIXTURE_DIR];
  if (override && override.length > 0) {
    return isAbsolute(override) ? override : join(PROJECT_ROOT, override);
  }
  return join(PROJECT_ROOT, 'test', 'fixtures');
}

function readFixtureFile(dir, relPath) {
  const full = join(dir, relPath);
  if (!existsSync(full)) {
    throw new PddCliError({
      code: 'E_FIXTURE_MISSING',
      message: `mock adapter: fixture not found at ${full}`,
      hint: `确认 ${ENV_FIXTURE_DIR} 与 fixture 文件名`,
      exitCode: ExitCodes.GENERAL,
    });
  }
  const raw = readFileSync(full, 'utf8');
  return JSON.parse(raw);
}

export class FixtureStore {
  constructor({ fixtureDir, env = {} } = {}) {
    if (typeof fixtureDir === 'string' && fixtureDir.length > 0) {
      this._dir = isAbsolute(fixtureDir) ? fixtureDir : join(PROJECT_ROOT, fixtureDir);
    } else {
      this._dir = resolveFixtureDir(env);
    }
    this._cache = new Map();
  }

  get dir() {
    return this._dir;
  }

  load(relPath) {
    const full = join(this._dir, relPath);
    if (this._cache.has(full)) return this._cache.get(full);
    const parsed = readFixtureFile(this._dir, relPath);
    this._cache.set(full, parsed);
    return parsed;
  }
}

export function loadFixture(relPath, env = {}) {
  return readFixtureFile(resolveFixtureDir(env), relPath);
}
