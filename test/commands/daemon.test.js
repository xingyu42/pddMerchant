import assert from 'node:assert/strict';
import { it, vi } from 'vitest';
import { executeSingle } from '../../src/commands/runner/single-lifecycle.js';
import { getDaemonStatus } from '../../src/services/daemon.js';
import { appendActionWarnings } from '../../src/commands/runner/fixture-runtime.js';
import { insertAccount, insertPendingAction } from '../../src/infra/account-store.js';
import { acquireDaemonLease } from '../../src/infra/daemon-state.js';
import { spawnDaemonProcess } from '../../src/adapter/daemon-process.js';
import { run as doctor } from '../../src/commands/doctor.js';
import { saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { createCliSandbox } from '../helpers/isolated-cli.js';

vi.mock('../../src/adapter/daemon-process.js', () => ({ spawnDaemonProcess: vi.fn(), killDaemonProcess: vi.fn() }));
vi.mock('../../src/infra/output.js', async (importOriginal) => ({ ...await importOriginal(), emit: vi.fn() }));

it('ordinary fixture commands and doctor leave background launch explicit', async () => {
  const account = insertAccount({ identity: '900001', displayName: 'Shop' }, { setDefault: true });
  saveAuthStateSnapshot({ cookies: [{ name: 'PASS_ID', value: 'synthetic' }], origins: [] }, account.id);
  insertPendingAction(account.id, { kind: 'human_takeover', reason: 'sms' });
  const ordinary = await executeSingle({ name: 'test.ordinary', needsAuth: true, needsMall: 'none', run: async () => ({}) },
    {}, { emitResult: false });
  assert.equal(ordinary.ok, true);
  const fixtures = createCliSandbox();
  try {
    vi.stubEnv('PDD_TEST_FIXTURE_DIR', fixtures.fixtureDir);
    const result = await doctor({ json: true });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(Object.hasOwn(result.data, 'daemon'), false);
    assert.deepEqual(result.meta.warnings, []);
    assert.equal(spawnDaemonProcess.mock.calls.length, 0);
  } finally { fixtures.dispose(); }
});

it('runs daemon status in live mode with no browser or account resolution', async () => {
  vi.stubEnv('PDD_TEST_ADAPTER', '');
  insertAccount({ identity: '900001', displayName: 'One' });
  insertAccount({ identity: '900002', displayName: 'Two' });
  const envelope = await executeSingle({ name: 'daemon.status', needsAuth: false, needsMall: 'none', needsBrowser: false,
    run: () => getDaemonStatus() }, {}, { emitResult: false });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.running, false);
  assert.equal(spawnDaemonProcess.mock.calls.length, 0);
});

it('keeps pending-action checks scoped and deduplicates the daemon warning', async () => {
  const account = insertAccount({ identity: '900001', displayName: 'Shop' });
  insertPendingAction(account.id, { kind: 'human_takeover', reason: 'sms' });
  const runtime = { accountCtx: { accountId: account.id, slug: account.slug }, warnings: [] };
  appendActionWarnings({ needsAuth: false }, runtime);
  assert.deepEqual(runtime.warnings, []);
  appendActionWarnings({ needsAuth: true }, runtime);
  appendActionWarnings({ needsAuth: true }, runtime);
  assert.deepEqual(runtime.warnings.filter((warning) => warning.code === 'daemon_not_running'), [{ code: 'daemon_not_running' }]);
  runtime.warnings = [];
  await acquireDaemonLease();
  appendActionWarnings({ needsAuth: true }, runtime);
  assert.equal(runtime.warnings.some((warning) => warning.code === 'daemon_not_running'), false);
});
