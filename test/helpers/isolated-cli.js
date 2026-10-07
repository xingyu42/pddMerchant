import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_FIELD_DEFINITIONS } from '../../src/infra/config.js';
import { assertEnvelopeShape } from './envelope-assertions.js';

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
    env[CONFIG_FIELD_DEFINITIONS[field].env] = String(value);
  }
  Object.assign(env, {
    PDD_TEST_ADAPTER: 'fixture', PDD_TEST_FIXTURE_DIR: fixtureDir,
    PDD_AUTH_STATE_PATH: join(root, 'merchant-auth.json'),
    PDD_CONSUMER_AUTH_STATE_PATH: join(root, 'consumer-auth.json'),
    PDD_ACCOUNTS_DIR: join(root, 'merchant'),
    PDD_ACCOUNT_REGISTRY_PATH: join(root, 'merchant-registry.json'),
    PDD_CONSUMER_ACCOUNTS_DIR: join(root, 'consumer'),
    PDD_CONSUMER_ACCOUNT_REGISTRY_PATH: join(root, 'consumer-registry.json'),
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

// registry：写入合成账号 registry；--all-accounts 与显式 PDD_AUTH_STATE_PATH 互斥，故此时移除该变量
export function runCli(args, { fixtures, authInvalid = false, authIndeterminate = false, authState, registry } = {}) {
  const sandbox = createCliSandbox(fixtures);
  try {
    if (args.includes('--all-accounts')) delete sandbox.env.PDD_AUTH_STATE_PATH;
    if (authInvalid) sandbox.env.PDD_TEST_AUTH_INVALID = '1';
    if (authIndeterminate) sandbox.env.PDD_TEST_AUTH_INDETERMINATE = '1';
    if (authState) writeFileSync(sandbox.env.PDD_AUTH_STATE_PATH, JSON.stringify(authState));
    if (registry) writeFileSync(sandbox.env.PDD_ACCOUNT_REGISTRY_PATH, JSON.stringify(registry));
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
