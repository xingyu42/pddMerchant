import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_FIELD_DEFINITIONS } from '../../src/infra/config.js';
import { assertEnvelopeShape } from './envelope-assertions.js';
import { seedDb, DEFAULT_ACCOUNT } from './seed-db.js';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const cliPath = join(projectRoot, 'bin', 'pdd.js');
const preloadUrl = new URL('./offline-preload.js', import.meta.url).href;
export const runtimeConfig = Object.freeze({
  ...JSON.parse(readFileSync(join(projectRoot, 'config', 'config.example.json'), 'utf8')),
  logLevel: 'fatal',
});

export function createCliSandbox(fixtures = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pdd-cli-'));
  const fixtureDir = join(root, 'fixtures');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(path|pathext|systemroot|windir|comspec|temp|tmp|lang)$/i.test(key)));
  for (const [field, value] of Object.entries(runtimeConfig)) {
    if (CONFIG_FIELD_DEFINITIONS[field]) env[CONFIG_FIELD_DEFINITIONS[field].env] = String(value);
  }
  Object.assign(env, {
    PDD_TEST_ADAPTER: 'fixture', PDD_TEST_FIXTURE_DIR: fixtureDir,
    PDD_DB_PATH: join(root, 'pdd.db'),
    PDD_TIMEOUT_MS: '10000', PDD_DEFAULT_MALL: '900001', NO_COLOR: '1', TZ: 'UTC',
  });
  try {
    for (const [name, data] of Object.entries({
      'shops.current.json': { id: '900001', name: 'Synthetic Shop' },
      'shops.list.json': [{ id: '900001', name: 'Synthetic Shop' }],
      ...fixtures,
    })) {
      const path = join(fixtureDir, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(data));
    }
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  return { root, env, fixtureDir, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

export function runCli(args, { fixtures, authInvalid = false, authIndeterminate = false, authState, accounts = [DEFAULT_ACCOUNT], authStates } = {}) {
  const sandbox = createCliSandbox(fixtures);
  try {
    if (authInvalid) sandbox.env.PDD_TEST_AUTH_INVALID = '1';
    if (authIndeterminate) sandbox.env.PDD_TEST_AUTH_INDETERMINATE = '1';
    seedDb(sandbox.env.PDD_DB_PATH, { accounts, authStates: authStates ?? accounts.map((account) => ({
      slug: account.slug, state: authState ?? { cookies: [], origins: [] },
    })) });
    const result = spawnSync(process.execPath, ['--import', preloadUrl, cliPath, ...args, '--json'], {
      cwd: projectRoot, env: sandbox.env, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, 'CLI must exit normally, not be killed');
    assert.ok(result.stdout.trim(), `CLI produced no JSON (exit ${result.status}); stderr: ${result.stderr}`);
    const lines = result.stdout.trim().split(/\r?\n/);
    assert.equal(lines.length, 1, `Expected one JSON line; stderr: ${result.stderr}`);
    const envelope = JSON.parse(lines[0]);
    assertEnvelopeShape(envelope, { exitCode: result.status });
    return { ...result, envelope };
  } finally {
    sandbox.dispose();
  }
}
