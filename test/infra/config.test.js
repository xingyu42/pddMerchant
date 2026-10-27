import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { it } from 'vitest';
import { getDatabasePath } from '../../src/infra/db.js';
import { loadRuntimeConfig, inspectConfig, parseWritableConfigField } from '../../src/infra/config.js';
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
