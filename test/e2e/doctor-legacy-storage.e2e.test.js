import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { createCliSandbox } from '../helpers/isolated-cli.js';
import { seedDb, DEFAULT_ACCOUNT } from '../helpers/seed-db.js';
import { assertEnvelopeShape } from '../helpers/envelope-assertions.js';
import { assertDataContractV2 } from '../helpers/data-contract.js';
import { closeDatabase, getDatabasePath, openDatabase } from '../../src/infra/db.js';
import { hasLegacyStorage } from '../../src/services/doctor-storage.js';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const preloadUrl = new URL('../helpers/offline-preload.js', import.meta.url).href;
const message = '检测到旧版数据，已不再使用，可手动删除';
const legacyPaths = [
  'merchant/stores/registry.json', 'consumer/accounts/registry.json',
  'merchant/stores/synthetic/auth-state.json', 'consumer/accounts/synthetic/auth-state.json',
];

function writeSynthetic(root, relativePath, content = 'synthetic invalid JSON') {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

function withDoctorSandbox(check, { accounts = [DEFAULT_ACCOUNT] } = {}) {
  const sandbox = createCliSandbox();
  try {
    seedDb(sandbox.env.PDD_DB_PATH, { accounts, authStates: accounts.map((account) => ({
      slug: account.slug, state: { cookies: [], origins: [] },
    })) });
    check(sandbox);
  } finally { sandbox.dispose(); }
}

function runDoctor(sandbox, { json = true, ok = true, exitCode = 0 } = {}) {
  const result = spawnSync(process.execPath, ['--import', preloadUrl, join(projectRoot, 'bin/pdd.js'),
    'doctor', ...(json ? ['--json'] : [])], {
    cwd: projectRoot, env: sandbox.env, encoding: 'utf8', timeout: 15000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, exitCode);
  if (!json) return result;
  assert.equal(result.stdout.trim().split(/\r?\n/).length, 1);
  const envelope = JSON.parse(result.stdout);
  assertEnvelopeShape(envelope, { command: 'doctor', ok, exitCode });
  if (ok) assertDataContractV2(envelope.data);
  return { ...result, envelope };
}

function legacyWarnings(envelope) {
  return envelope.meta.warnings.filter((warning) => warning?.code === 'legacy_storage_detected');
}

it('legacy detection follows the currently opened database path', async () => {
  const previous = getDatabasePath();
  const first = createCliSandbox();
  const second = createCliSandbox();
  try {
    writeSynthetic(first.root, legacyPaths[0]);
    openDatabase(first.env.PDD_DB_PATH);
    assert.equal(await hasLegacyStorage(), true);
    openDatabase(second.env.PDD_DB_PATH);
    assert.equal(await hasLegacyStorage(), false);
    openDatabase(first.env.PDD_DB_PATH);
    assert.equal(await hasLegacyStorage(), true);
  } finally {
    closeDatabase();
    first.dispose();
    second.dispose();
    openDatabase(previous);
  }
});

it.each(legacyPaths)('doctor detects synthetic legacy data at %s without changing it', (relativePath) => {
  withDoctorSandbox((sandbox) => {
    const path = writeSynthetic(sandbox.root, relativePath);
    const { envelope } = runDoctor(sandbox);
    assert.deepEqual(legacyWarnings(envelope), [{ code: 'legacy_storage_detected' }]);
    assert.equal(envelope.data.headline.filter((line) => line === message).length, 1);
    assert.equal(existsSync(path), true);
    assert.equal(readFileSync(path, 'utf8'), 'synthetic invalid JSON');
  });
});

it('doctor adds no legacy warning or headline when legacy data is absent', () => {
  withDoctorSandbox((sandbox) => {
    const { envelope } = runDoctor(sandbox);
    assert.deepEqual(legacyWarnings(envelope), []);
    assert.equal(envelope.data.headline.includes(message), false);
    assert.equal(envelope.data.headline.length, 2);
  });
});

it('doctor legacy output contains no paths or file contents in JSON or human mode', () => {
  withDoctorSandbox((sandbox) => {
    const content = 'SYNTHETIC-LEGACY-SECRET-c470b';
    for (const path of legacyPaths) writeSynthetic(sandbox.root, path, content);
    for (const json of [true, false]) {
      const result = runDoctor(sandbox, { json });
      const output = result.stdout + result.stderr;
      assert.equal(result.stdout.split(/\r?\n/).filter((line) => line === message).length, json ? 0 : 1);
      for (const fragment of ['registry.json', 'auth-state.json', 'merchant/stores', 'consumer/accounts',
        sandbox.root, sandbox.root.replaceAll('\\', '/'), content]) {
        assert.equal(output.includes(fragment), false, 'legacy storage details must remain private');
      }
    }
  });
});

it('doctor ignores deeper legacy files and directories named like legacy files', () => {
  withDoctorSandbox((sandbox) => {
    writeSynthetic(sandbox.root, 'merchant/stores/shop/deeper/auth-state.json');
    writeSynthetic(sandbox.root, 'consumer/accounts/account/deeper/auth-state.json');
    mkdirSync(join(sandbox.root, 'merchant/stores/registry.json'));
    mkdirSync(join(sandbox.root, 'consumer/accounts/account/auth-state.json'));
    const { envelope } = runDoctor(sandbox);
    assert.deepEqual(legacyWarnings(envelope), []);
    assert.equal(envelope.data.headline.includes(message), false);
  });
});

it.each([
  'merchant', 'merchant/stores', 'merchant/stores/linked',
  'consumer', 'consumer/accounts', 'consumer/accounts/linked',
])('doctor skips linked legacy directories at %s', (relativeLink) => {
  withDoctorSandbox((sandbox) => {
    const parts = relativeLink.split('/');
    const target = join(sandbox.root, 'synthetic-link-target');
    const relativePath = parts.length === 1
      ? `${parts[0] === 'merchant' ? 'stores' : 'accounts'}/registry.json`
      : parts.length === 2 ? 'registry.json' : 'auth-state.json';
    writeSynthetic(target, relativePath);
    const link = join(sandbox.root, ...parts);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    const { envelope } = runDoctor(sandbox);
    assert.deepEqual(legacyWarnings(envelope), []);
    assert.equal(envelope.data.headline.includes(message), false);
  });
});

it('doctor retains the legacy warning and diagnostic headline when login is required', () => {
  withDoctorSandbox((sandbox) => {
    writeSynthetic(sandbox.root, legacyPaths[0]);
    const { envelope } = runDoctor(sandbox, { ok: false, exitCode: 3 });
    assert.equal(envelope.data, null);
    assert.equal(envelope.error.code, 'E_AUTH_STATE_MISSING');
    assert.deepEqual(legacyWarnings(envelope), [{ code: 'legacy_storage_detected' }]);
    assert.deepEqual(envelope.error.detail.headline, [message]);
  }, { accounts: [] });
});
