import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { getDatabasePath } from '../../src/infra/db.js';
import { CONFIG_FIELD_DEFINITIONS, loadRuntimeConfig, inspectConfig, parseWritableConfigField } from '../../src/infra/config.js';
import { TIMEOUTS } from '../../src/infra/timeouts.js';

function options(env = {}, cliFlags = {}) {
  return { env, cliFlags, configPath: join(dirname(getDatabasePath()), 'absent-config.json') };
}

it('loads the password relogin baseline and standalone timeout', async () => {
  const config = await loadRuntimeConfig(options());
  assert.equal(config.passwordReloginMinIntervalMs, 1_800_000);
  assert.equal(TIMEOUTS.LOGIN_PASSWORD, 90_000);
  const inspection = await inspectConfig(options());
  assert.equal(inspection.sources.passwordReloginMinIntervalMs, 'baseline');
});

it('accepts positive integer overrides in environment and CLI with normal precedence', async () => {
  const env = { PDD_PASSWORD_RELOGIN_MIN_INTERVAL_MS: '60000' };
  assert.equal((await loadRuntimeConfig(options(env))).passwordReloginMinIntervalMs, 60_000);
  assert.equal((await loadRuntimeConfig(options(env, { passwordReloginMinIntervalMs: 1 }))).passwordReloginMinIntervalMs, 1);
  assert.equal(parseWritableConfigField('passwordReloginMinIntervalMs', '100'), 100);
});

it.each(['0', '-1', '1.5', 'invalid', 'Infinity'])('rejects invalid password relogin interval %s', async (value) => {
  await assert.rejects(loadRuntimeConfig(options({ PDD_PASSWORD_RELOGIN_MIN_INTERVAL_MS: value })), { code: 'E_CONFIG_INVALID' });
  assert.throws(() => parseWritableConfigField('passwordReloginMinIntervalMs', value), { code: 'E_CONFIG_INVALID' });
});

it('loads daemon and console defaults exclusively from the baseline', async () => {
  const config = await loadRuntimeConfig(options());
  const expected = { consoleHost: '127.0.0.1', consolePort: 47821, consolePublicUrl: '', patrolEnabled: false, patrolIntervalMs: 1800000 };
  const inspection = await inspectConfig(options());
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(config[key], value);
    assert.equal(inspection.sources[key], 'baseline');
  }
});

it('allows an empty public URL environment override to clear a local reverse-proxy URL', async () => {
  const configOptions = options({ PDD_CONSOLE_PUBLIC_URL: '' });
  writeFileSync(configOptions.configPath, JSON.stringify({ consolePublicUrl: 'https://console.example.test' }));
  assert.equal((await loadRuntimeConfig(configOptions)).consolePublicUrl, '');
  assert.equal((await inspectConfig(configOptions)).sources.consolePublicUrl, 'env');
});

it('allows an empty string only in the consolePublicUrl schema', () => {
  const acceptingKeys = Object.entries(CONFIG_FIELD_DEFINITIONS)
    .filter(([, definition]) => definition.schema.safeParse('').success)
    .map(([key]) => key);
  assert.deepEqual(acceptingKeys, ['consolePublicUrl']);
});

it.each(Object.entries(CONFIG_FIELD_DEFINITIONS).filter(([key]) => !['consoleHost', 'consolePublicUrl'].includes(key)))(
  'keeps ignoring empty environment values for %s', async (key, definition) => {
    const baseline = await loadRuntimeConfig(options());
    const configOptions = options({ [definition.env]: '' });
    assert.deepEqual(await loadRuntimeConfig(configOptions), baseline);
    const inspection = await inspectConfig(configOptions);
    assert.deepEqual(inspection.layers.environment.value, {});
    assert.notEqual(inspection.sources[key], 'env');
  },
);

it.each(['', ' \t\r\n '])('rejects blank console hosts in local and baseline configuration %#', async (value) => {
  const configOptions = options();
  const baseline = await loadRuntimeConfig(configOptions);
  writeFileSync(configOptions.configPath, JSON.stringify({ consoleHost: value }));
  await assert.rejects(loadRuntimeConfig(configOptions), (error) => {
    assert.equal(error.code, 'E_CONFIG_INVALID');
    assert.equal(error.detail.source, 'local');
    assert.equal(error.detail.issues[0].path, 'consoleHost');
    return true;
  });
  assert.equal((await inspectConfig(configOptions)).layers.local.valid, false);
  const baselinePath = join(dirname(configOptions.configPath), 'invalid-baseline.json');
  writeFileSync(baselinePath, JSON.stringify({ ...baseline, consoleHost: value }));
  await assert.rejects(loadRuntimeConfig({ ...configOptions, baselinePath }), (error) => {
    assert.equal(error.code, 'E_CONFIG_INVALID');
    assert.equal(error.detail.source, 'baseline');
    assert.equal(error.detail.issues[0].path, 'consoleHost');
    return true;
  });
});

it.each([
  ['consoleHost', 'PDD_CONSOLE_HOST', '0.0.0.0', '0.0.0.0'],
  ['consoleHost', 'PDD_CONSOLE_HOST', ' 127.0.0.1 ', '127.0.0.1'],
  ['consolePort', 'PDD_CONSOLE_PORT', '1', 1],
  ['consolePort', 'PDD_CONSOLE_PORT', '65535', 65535],
  ['consolePublicUrl', 'PDD_CONSOLE_PUBLIC_URL', 'https://console.example.test/base', 'https://console.example.test/base'],
  ['consolePublicUrl', 'PDD_CONSOLE_PUBLIC_URL', 'http://127.0.0.1:47821', 'http://127.0.0.1:47821'],
  ['consolePublicUrl', 'PDD_CONSOLE_PUBLIC_URL', '', ''],
  ['patrolEnabled', 'PDD_PATROL_ENABLED', 'true', true],
  ['patrolEnabled', 'PDD_PATROL_ENABLED', '1', true],
  ['patrolEnabled', 'PDD_PATROL_ENABLED', 'false', false],
  ['patrolEnabled', 'PDD_PATROL_ENABLED', '0', false],
  ['patrolIntervalMs', 'PDD_PATROL_INTERVAL_MS', '300000', 300000],
])('parses daemon environment and writable configuration %#', async (key, envKey, raw, expected) => {
  assert.equal((await loadRuntimeConfig(options({ [envKey]: raw })))[key], expected);
  assert.equal(parseWritableConfigField(key, raw), expected);
  assert.equal((await inspectConfig(options({ [envKey]: raw }))).sources[key], 'env');
});

it.each([
  ['consoleHost', 'PDD_CONSOLE_HOST', ''],
  ['consoleHost', 'PDD_CONSOLE_HOST', ' \t\r\n '],
  ['consolePort', 'PDD_CONSOLE_PORT', '0'],
  ['consolePort', 'PDD_CONSOLE_PORT', '65536'],
  ['consolePort', 'PDD_CONSOLE_PORT', '47821.5'],
  ['consolePort', 'PDD_CONSOLE_PORT', 'invalid'],
  ['consolePublicUrl', 'PDD_CONSOLE_PUBLIC_URL', '/console'],
  ['consolePublicUrl', 'PDD_CONSOLE_PUBLIC_URL', 'ftp://console.example.test'],
  ['consolePublicUrl', 'PDD_CONSOLE_PUBLIC_URL', 'https://'],
  ['patrolEnabled', 'PDD_PATROL_ENABLED', 'yes'],
  ['patrolEnabled', 'PDD_PATROL_ENABLED', '2'],
  ['patrolIntervalMs', 'PDD_PATROL_INTERVAL_MS', '299999'],
  ['patrolIntervalMs', 'PDD_PATROL_INTERVAL_MS', '300000.5'],
  ['patrolIntervalMs', 'PDD_PATROL_INTERVAL_MS', 'Infinity'],
])('rejects invalid daemon environment and config set input %#', async (key, envKey, raw) => {
  await assert.rejects(loadRuntimeConfig(options({ [envKey]: raw })), { code: 'E_CONFIG_INVALID' });
  assert.throws(() => parseWritableConfigField(key, raw), { code: 'E_CONFIG_INVALID' });
});
