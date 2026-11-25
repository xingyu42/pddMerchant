import assert from 'node:assert/strict';
import { hostname } from 'node:os';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { run } from '../../src/infra/db.js';
import { acquireDaemonLease, readDaemonLease, readDaemonOwnerToken, setDaemonMeta, getDaemonMeta } from '../../src/infra/daemon-state.js';
import { startDaemon, stopDaemon, restartDaemon, getDaemonStatus } from '../../src/services/daemon.js';
import { composeCommandRuntime } from '../../src/runtime/command-runtime.js';
import { createInMemoryDaemonProcessPort } from '../helpers/in-memory-ports.js';

let spawnDetached;
let stopByPid;
let onSpawnHandler;
let failKillPids;
const runtimes = [];

async function makeRuntime() {
  const port = createInMemoryDaemonProcessPort({
    initialPids: [12345],
    failKillPids,
    onSpawn: (pid, record) => onSpawnHandler?.(pid, record),
  });
  spawnDetached = vi.fn(port.spawnDetached);
  stopByPid = vi.fn(port.stopByPid);
  const runtime = await composeCommandRuntime({
    mode: 'live',
    runtimeConfigPolicy: 'maintenance',
    env: {},
    overrides: {
      daemonProcess: {
        spawnDetached,
        stopByPid,
        isRunning: port.isRunning,
      },
    },
  });
  runtimes.push(runtime);
  return runtime;
}

beforeEach(() => {
  onSpawnHandler = null;
  failKillPids = new Set();
  spawnDetached = vi.fn();
  stopByPid = vi.fn();
});

afterEach(async () => {
  while (runtimes.length > 0) {
    await runtimes.pop().closeAll();
  }
});

async function activeLease(host = hostname()) {
  await acquireDaemonLease();
  setDaemonMeta('daemon_console_url', 'http://127.0.0.1:47821');
  run('UPDATE leases SET pid = ?, hostname = ? WHERE scope = ?', 12345, host, 'daemon');
}

async function advance(promise, duration) {
  const result = promise.catch((error) => error);
  await vi.advanceTimersByTimeAsync(duration);
  return result;
}

it('returns existing status without spawning or leaking owner tokens', async () => {
  const runtime = await makeRuntime();
  await activeLease();
  const result = await startDaemon({ runtime });
  assert.equal(result.started, false);
  assert.equal(spawnDetached.mock.calls.length, 0);
  assert.equal(JSON.stringify(result).includes(readDaemonOwnerToken()), false);
  assert.equal(getDaemonStatus({ patrolEnabled: true }).patrol_enabled, true);
});

it('polls until the child acquires the lease and reports started', async () => {
  vi.useFakeTimers();
  onSpawnHandler = () => { setTimeout(async () => {
    await acquireDaemonLease();
    setDaemonMeta('daemon_console_url', 'http://127.0.0.1:47821');
  }, 300); };
  const runtime = await makeRuntime();
  const result = await advance(startDaemon({ runtime }), 400);
  assert.equal(result.started, true);
  assert.equal(spawnDetached.mock.calls.length, 1);
  assert.deepEqual(spawnDetached.mock.calls[0], []);
});

it('clears a stale address and waits for the new listener to publish its URL', async () => {
  vi.useFakeTimers();
  setDaemonMeta('daemon_console_url', 'http://stale.example');
  onSpawnHandler = () => {
    acquireDaemonLease();
    setTimeout(() => setDaemonMeta('daemon_console_url', 'http://127.0.0.1:47821'), 600);
  };
  const runtime = await makeRuntime();
  const pending = startDaemon({ runtime });
  await vi.advanceTimersByTimeAsync(200);
  assert.equal(getDaemonStatus().console_url, null);
  const result = await advance(pending, 400);
  assert.equal(result.console_url, 'http://127.0.0.1:47821');
});

it('times out after ten seconds if the child never acquires', async () => {
  vi.useFakeTimers();
  const runtime = await makeRuntime();
  const result = await advance(startDaemon({ runtime }), 10000);
  assert.equal(result.code, 'E_DAEMON_START_TIMEOUT');
});

it('returns stopped false when no daemon is running', async () => {
  const runtime = await makeRuntime();
  assert.deepEqual(await stopDaemon({ runtime }), { headline: ['daemon 当前已停止'], stopped: false, running: false });
  assert.equal(stopByPid.mock.calls.length, 0);
});

it('requests cooperative shutdown and waits for release', async () => {
  await activeLease();
  vi.useFakeTimers();
  const runtime = await makeRuntime();
  setTimeout(() => run("DELETE FROM leases WHERE scope = 'daemon'"), 700);
  const result = await advance(stopDaemon({ runtime }), 1000);
  assert.equal(result.stopped, true);
  assert.equal(result.forced, undefined);
  assert.equal(stopByPid.mock.calls.length, 0);
});

it('force kills a same-host live lease and deletes only its owner row', async () => {
  await activeLease();
  vi.useFakeTimers();
  const runtime = await makeRuntime();
  const result = await advance(stopDaemon({ runtime }), 15000);
  assert.equal(result.forced, true);
  assert.deepEqual(stopByPid.mock.calls, [[12345]]);
  assert.equal(readDaemonLease(), null);
  assert.equal(getDaemonMeta('daemon_console_url'), null);
});

it('rejects foreign-host force stop with safe detail', async () => {
  await activeLease('foreign-host');
  vi.useFakeTimers();
  const runtime = await makeRuntime();
  const result = await advance(stopDaemon({ runtime }), 15000);
  assert.equal(result.code, 'E_DAEMON_STOP_TIMEOUT');
  assert.deepEqual(result.detail, { reason: 'foreign_host' });
  assert.equal(stopByPid.mock.calls.length, 0);
});

it('preserves a replacement owner when stopping races with takeover', async () => {
  await activeLease();
  vi.useFakeTimers();
  const runtime = await makeRuntime();
  setTimeout(() => run("UPDATE leases SET owner_token = 'replacement' WHERE scope = 'daemon'"), 500);
  const result = await advance(stopDaemon({ runtime }), 15000);
  assert.equal(result.code, 'E_DAEMON_STOP_TIMEOUT');
  assert.equal(readDaemonOwnerToken(), 'replacement');
  assert.equal(stopByPid.mock.calls.length, 0);
});

it('does not kill an expired heartbeat lease', async () => {
  await activeLease();
  vi.useFakeTimers();
  const runtime = await makeRuntime();
  run("UPDATE leases SET expires_at = ? WHERE scope = 'daemon'", new Date(Date.now() + 700).toISOString());
  const result = await advance(stopDaemon({ runtime }), 1000);
  assert.equal(result.stopped, true);
  assert.equal(stopByPid.mock.calls.length, 0);
});

it('keeps the lease on kill failure and sanitizes the error', async () => {
  await activeLease();
  failKillPids = new Set([12345]);
  vi.useFakeTimers();
  const runtime = await makeRuntime();
  const result = await advance(stopDaemon({ runtime }), 15000);
  assert.equal(result.code, 'E_DAEMON_STOP_TIMEOUT');
  assert.deepEqual(result.detail, { pid: 12345, reason: 'kill_failed' });
  assert.equal(readDaemonLease().running, true);
});

function spawnPublishes() {
  onSpawnHandler = () => { setTimeout(async () => {
    await acquireDaemonLease();
    setDaemonMeta('daemon_console_url', 'http://127.0.0.1:47822');
  }, 300); };
}

it('restart starts a stopped daemon without killing anything', async () => {
  vi.useFakeTimers();
  spawnPublishes();
  const runtime = await makeRuntime();
  const result = await advance(restartDaemon({ runtime }), 400);
  assert.deepEqual([result.headline, result.restarted, result.started], [['daemon 已启动'], false, true]);
  assert.equal(stopByPid.mock.calls.length, 0);
  assert.equal(spawnDetached.mock.calls.length, 1);
});

it('restart stops the running daemon cooperatively and spawns a fresh one', async () => {
  await activeLease();
  vi.useFakeTimers();
  setTimeout(() => run("DELETE FROM leases WHERE scope = 'daemon'"), 700);
  spawnPublishes();
  const runtime = await makeRuntime();
  const result = await advance(restartDaemon({ runtime }), 2000);
  assert.deepEqual([result.headline, result.restarted, result.started], [['daemon 已重启'], true, true]);
  assert.equal(result.forced, undefined);
  assert.equal(result.console_url, 'http://127.0.0.1:47822');
  assert.equal(stopByPid.mock.calls.length, 0);
  assert.equal(spawnDetached.mock.calls.length, 1);
});
