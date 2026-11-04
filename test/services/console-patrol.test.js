import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { getConsolePatrol, savePatrolEnabled, setConsolePatrol } from '../../src/services/console-patrol.js';
import { createPatrol } from '../../src/services/patrol.js';
import { setDaemonMeta } from '../../src/infra/daemon-state.js';

const exampleConfig = fileURLToPath(new URL('../../config/config.example.json', import.meta.url));
let root;
let configOptions;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pdd-patrol-switch-'));
  const configDir = join(root, 'config');
  mkdirSync(configDir);
  copyFileSync(exampleConfig, join(configDir, 'config.example.json'));
  configOptions = { projectRoot: root, configDir, baselinePath: join(configDir, 'config.example.json'),
    configPath: join(configDir, 'config.json'), env: {} };
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function context(patrolEnabled = false) {
  return { signal: new AbortController().signal, log: { info: vi.fn(), warn: vi.fn() },
    runtimeConfig: { patrolEnabled, patrolIntervalMs: 1_800_000 } };
}

it('persists the switch into the local config used by pdd config set', async () => {
  await savePatrolEnabled(true, configOptions);
  assert.deepEqual(JSON.parse(readFileSync(configOptions.configPath, 'utf8')), { patrolEnabled: true });
  await savePatrolEnabled(false, configOptions);
  assert.deepEqual(JSON.parse(readFileSync(configOptions.configPath, 'utf8')), { patrolEnabled: false });
});

it('refuses a switch that an environment override would mask', async () => {
  await assert.rejects(savePatrolEnabled(true, { ...configOptions, env: { PDD_PATROL_ENABLED: 'false' } }),
    { code: 'E_CONFIG_OVERRIDDEN', httpStatus: 409 });
});

it('starts and stops the loop live, after persisting each change', async () => {
  vi.useFakeTimers();
  const persist = vi.fn(async () => {});
  const sleep = vi.fn((ms, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const patrol = createPatrol({ persist, clock: { now: Date.now, sleep } });
  await patrol.start(context(false));
  assert.equal(patrol.isEnabled(), false);
  await patrol.setEnabled(true);
  assert.deepEqual([persist.mock.calls[0][0], patrol.isEnabled(), sleep.mock.calls.length], [true, true, 1]);
  await patrol.setEnabled(false);
  assert.deepEqual([persist.mock.calls[1][0], patrol.isEnabled()], [false, false]);
  await patrol.stop();
  await patrol.setEnabled(true);
  assert.equal(patrol.isEnabled(), false);
});

it('keeps the running state when persisting fails', async () => {
  const persist = vi.fn(async () => { throw new Error('disk full'); });
  const patrol = createPatrol({ persist, clock: { now: Date.now, sleep: () => new Promise(() => {}) } });
  await patrol.start(context(false));
  await assert.rejects(patrol.setEnabled(true), /disk full/);
  assert.equal(patrol.isEnabled(), false);
});

it('projects a console view and validates the switch body', async () => {
  setDaemonMeta('daemon_last_patrol_at', '2026-11-04T00:00:00.000Z');
  const patrol = { isEnabled: vi.fn(() => true), setEnabled: vi.fn(async () => {}) };
  const runtimeConfig = { patrolIntervalMs: 1_800_000 };
  assert.deepEqual(getConsolePatrol(patrol, runtimeConfig),
    { enabled: true, interval_minutes: 30, last_patrol_at: '2026-11-04 08:00:00' });
  await assert.rejects(setConsolePatrol(patrol, { enabled: 'yes' }, runtimeConfig), { httpStatus: 400 });
  await setConsolePatrol(patrol, { enabled: false }, runtimeConfig);
  assert.deepEqual(patrol.setEnabled.mock.calls, [[false]]);
  assert.throws(() => getConsolePatrol(undefined, runtimeConfig), { httpStatus: 503 });
});
