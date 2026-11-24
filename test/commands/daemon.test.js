import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { it, vi } from 'vitest';
import { executeSingle } from '../../src/commands/runner/single-lifecycle.js';
import { getDaemonStatus } from '../../src/services/daemon.js';
import { appendActionWarnings } from '../../src/commands/runner/fixture-runtime.js';
import { insertAccount, insertPendingAction } from '../../src/infra/account-store.js';
import { acquireDaemonLease } from '../../src/infra/daemon-state.js';
import { run as doctor } from '../../src/commands/doctor.js';
import { saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { composeCommandRuntime } from '../../src/runtime/command-runtime.js';
import { createInMemoryDaemonProcessPort } from '../helpers/in-memory-ports.js';
import { createCliSandbox } from '../helpers/isolated-cli.js';

function makeMemoryStreams() {
  const stdoutChunks = [];
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.on('data', (chunk) => stdoutChunks.push(chunk.toString('utf8')));
  return {
    streams: { stdout, stderr },
    readStdout: () => stdoutChunks.join(''),
  };
}

function makeDaemonProcessOverride() {
  const port = createInMemoryDaemonProcessPort();
  const spawnDetached = vi.fn(port.spawnDetached);
  return {
    spawnDetached,
    port: {
      ...port,
      spawnDetached,
    },
  };
}

it('ordinary fixture commands and doctor leave background launch explicit', async () => {
  const account = insertAccount({ identity: '900001', displayName: 'Shop' }, { setDefault: true });
  saveAuthStateSnapshot({ cookies: [{ name: 'PASS_ID', value: 'synthetic' }], origins: [] }, account.id);
  insertPendingAction(account.id, { kind: 'human_takeover', reason: 'sms' });
  const fixtures = createCliSandbox();
  const { spawnDetached, port: daemonProcess } = makeDaemonProcessOverride();
  const ordinaryStreams = makeMemoryStreams();
  const doctorStreams = makeMemoryStreams();
  const ordinaryRuntime = await composeCommandRuntime({
    mode: 'fixture',
    runtimeConfigPolicy: 'maintenance',
    env: { PDD_TEST_FIXTURE_DIR: fixtures.fixtureDir },
    streams: ordinaryStreams.streams,
    overrides: { daemonProcess },
  });
  const doctorRuntime = await composeCommandRuntime({
    mode: 'fixture',
    runtimeConfigPolicy: 'maintenance',
    env: { PDD_TEST_FIXTURE_DIR: fixtures.fixtureDir },
    streams: doctorStreams.streams,
    overrides: { daemonProcess },
  });
  try {
    const ordinary = await executeSingle(
      { name: 'test.ordinary', needsAuth: true, needsMall: 'none', run: async () => ({}) },
      {},
      { emitResult: false, runtime: ordinaryRuntime },
    );
    assert.equal(ordinary.ok, true);
    const result = await doctor({ json: true }, { runtime: doctorRuntime });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(Object.hasOwn(result.data, 'daemon'), false);
    assert.deepEqual(result.meta.warnings, []);
    assert.equal(doctorRuntime.outputSink.hasEmitted(), true);
    assert.deepEqual(JSON.parse(doctorStreams.readStdout().trim()), result);
    assert.equal(spawnDetached.mock.calls.length, 0);
  } finally {
    await ordinaryRuntime.closeAll();
    await doctorRuntime.closeAll();
    fixtures.dispose();
  }
});

it('runs daemon status in live mode with no browser or account resolution', async () => {
  insertAccount({ identity: '900001', displayName: 'One' });
  insertAccount({ identity: '900002', displayName: 'Two' });
  const { spawnDetached, port: daemonProcess } = makeDaemonProcessOverride();
  const { streams } = makeMemoryStreams();
  const runtime = await composeCommandRuntime({
    mode: 'live',
    runtimeConfigPolicy: 'maintenance',
    env: {},
    streams,
    overrides: { daemonProcess },
  });
  try {
    const envelope = await executeSingle(
      { name: 'daemon.status', needsAuth: false, needsMall: 'none', needsBrowser: false, run: () => getDaemonStatus() },
      {},
      { emitResult: false, runtime },
    );
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.running, false);
    assert.equal(spawnDetached.mock.calls.length, 0);
  } finally {
    await runtime.closeAll();
  }
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
