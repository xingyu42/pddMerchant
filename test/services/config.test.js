import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { PddCliError } from '../../src/infra/errors.js';
import {
  setConfigValue,
  showConfig,
  unsetConfigValue,
  validateConfig,
} from '../../src/services/config.js';

const exampleConfig = fileURLToPath(new URL('../../config/config.example.json', import.meta.url));

let root;
let configOptions;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pdd-config-svc-'));
  const configDir = join(root, 'config');
  mkdirSync(configDir);
  copyFileSync(exampleConfig, join(configDir, 'config.example.json'));
  configOptions = {
    projectRoot: root,
    configDir,
    baselinePath: join(configDir, 'config.example.json'),
    configPath: join(configDir, 'config.json'),
    env: {},
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('config maintenance domain service', () => {
  it('shows and validates valid managed configuration without OutputSink coupling', async () => {
    const shown = await showConfig(configOptions);
    assert.equal(shown.path, 'config/config.json');
    assert.equal(shown.layers.baseline.valid, true);
    assert.equal(shown.layers.local.valid, true);

    const validated = await validateConfig(configOptions);
    assert.equal(validated.valid, true);
    assert.deepEqual(validated.headline, ['配置校验通过：基线、本地、环境变量与命令行各层均有效']);
  });

  it('sets and unsets valid local overrides and returns data + warnings', async () => {
    const setResult = await setConfigValue('rateLimitQps', '2.5', configOptions);
    assert.equal(setResult.data.changed, true);
    assert.equal(setResult.data.local_value, 2.5);
    assert.deepEqual(setResult.warnings, []);
    assert.deepEqual(JSON.parse(readFileSync(configOptions.configPath, 'utf8')), { rateLimitQps: 2.5 });

    const unsetResult = await unsetConfigValue('rateLimitQps', configOptions);
    assert.equal(unsetResult.data.removed, true);
    assert.deepEqual(unsetResult.warnings, []);
    assert.deepEqual(JSON.parse(readFileSync(configOptions.configPath, 'utf8')), {});
  });

  it('throws PddCliError directly on corrupted local JSON without overwriting it', async () => {
    const damaged = '{broken json';
    writeFileSync(configOptions.configPath, damaged);

    for (const op of [
      () => showConfig(configOptions),
      () => validateConfig(configOptions),
      () => setConfigValue('logLevel', 'debug', configOptions),
      () => unsetConfigValue('logLevel', configOptions),
    ]) {
      await assert.rejects(op, (err) => {
        assert.equal(err instanceof PddCliError, true);
        assert.equal(err.code, 'E_CONFIG_INVALID');
        return true;
      });
    }

    assert.equal(readFileSync(configOptions.configPath, 'utf8'), damaged);
  });

  it('throws PddCliError for unknown or invalid writable field values', async () => {
    await assert.rejects(
      () => setConfigValue('unknownKey', '1', configOptions),
      (err) => err instanceof PddCliError && err.code === 'E_CONFIG_INVALID' && err.detail.reason === 'unknown_field',
    );
    await assert.rejects(
      () => setConfigValue('consolePort', '70000', configOptions),
      (err) => err instanceof PddCliError && err.code === 'E_CONFIG_INVALID' && err.detail.reason === 'field_invalid',
    );
  });
});
