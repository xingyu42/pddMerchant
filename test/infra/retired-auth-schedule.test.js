import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { loadRuntimeConfig, inspectConfig, parseWritableConfigField } from '../../src/infra/config.js';
import { setLocalConfigValue, unsetLocalConfigValue } from '../../src/infra/config-management.js';
import { runtimeConfig } from '../helpers/isolated-cli.js';

let root;
let options;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pdd-no-auth-daemon-'));
  const configDir = join(root, 'config');
  await mkdir(configDir);
  options = { projectRoot: root, configDir, baselinePath: join(configDir, 'config.example.json'), configPath: join(configDir, 'config.json'), env: {} };
  await writeFile(options.baselinePath, JSON.stringify(runtimeConfig));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('retired merchant background configuration', () => {
  it('ignores only the two legacy schedule fields without rewriting the local file', async () => {
    const original = JSON.stringify({ refreshIntervalMs: 600000, refreshJitterMs: 120000, logLevel: 'info' });
    await writeFile(options.configPath, original);
    const config = await loadRuntimeConfig({ ...options, env: { PDD_REFRESH_INTERVAL_MS: 'invalid', PDD_REFRESH_JITTER_MS: 'invalid' } });
    assert.equal(config.logLevel, 'info');
    assert.ok(!Object.hasOwn(config, 'refreshIntervalMs'));
    assert.ok(!Object.hasOwn(config, 'refreshJitterMs'));
    assert.equal(await readFile(options.configPath, 'utf8'), original);
    const inspection = await inspectConfig(options);
    assert.equal(inspection.valid, true);
    assert.ok(!Object.hasOwn(inspection.localOverrides, 'refreshIntervalMs'));
  });

  it('still rejects unrelated unknown fields and forbids setting retired fields', async () => {
    await writeFile(options.configPath, JSON.stringify({ refreshIntervalMs: 600000, unexpected: true }));
    await assert.rejects(loadRuntimeConfig(options), { code: 'E_CONFIG_INVALID' });
    assert.throws(() => parseWritableConfigField('refreshIntervalMs', '600000'), { code: 'E_CONFIG_INVALID' });
  });

  it('config edits no longer request a background restart', async () => {
    const edited = await setLocalConfigValue('logLevel', 'info', options);
    assert.equal(edited.restartRequired, false);
    assert.deepEqual(edited.warnings, []);
  });

  it('allows explicit cleanup of legacy local scheduling keys', async () => {
    await writeFile(options.configPath, JSON.stringify({ refreshIntervalMs: 600000, refreshJitterMs: 120000, logLevel: 'warn' }));
    const result = await unsetLocalConfigValue('refreshIntervalMs', options);
    assert.equal(result.removed, true);
    assert.equal(result.runtimeValid, true);
    assert.equal(result.restartRequired, false);
    assert.deepEqual(JSON.parse(await readFile(options.configPath, 'utf8')), { logLevel: 'warn' });
  });
});
