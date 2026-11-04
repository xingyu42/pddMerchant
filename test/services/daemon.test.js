import assert from 'node:assert/strict';
import { hostname } from 'node:os';
import { beforeEach, it, vi } from 'vitest';
import { run } from '../../src/infra/db.js';
import { acquireDaemonLease, readDaemonLease, readDaemonOwnerToken, setDaemonMeta, getDaemonMeta } from '../../src/infra/daemon-state.js';
import { startDaemon, stopDaemon, restartDaemon, getDaemonStatus } from '../../src/services/daemon.js';
import { spawnDaemonProcess, killDaemonProcess } from '../../src/adapter/daemon-process.js';

vi.mock('../../src/adapter/daemon-process.js', () => ({ spawnDaemonProcess: vi.fn(), killDaemonProcess: vi.fn() }));
beforeEach(() => { spawnDaemonProcess.mockReset(); killDaemonProcess.mockReset(); });

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
  await activeLease();
  const result = await startDaemon();
  assert.equal(result.started, false);
  assert.equal(spawnDaemonProcess.mock.calls.length, 0);
  assert.equal(JSON.stringify(result).includes(readDaemonOwnerToken()), false);
  assert.equal(getDaemonStatus({ patrolEnabled: true }).patrol_enabled, true);
});

it('polls until the child acquires the lease and reports started', async () => {
  vi.useFakeTimers();
  spawnDaemonProcess.mockImplementation(() => { setTimeout(async () => {
    await acquireDaemonLease();
    setDaemonMeta('daemon_console_url', 'http://127.0.0.1:47821');
  }, 300); });
  const result = await advance(startDaemon(), 400);
  assert.equal(result.started, true);
  assert.equal(spawnDaemonProcess.mock.calls.length, 1);
});

it('clears a stale address and waits for the new listener to publish its URL', async () => {
  vi.useFakeTimers();
  setDaemonMeta('daemon_console_url', 'http://stale.example');
  spawnDaemonProcess.mockImplementation(() => {
    acquireDaemonLease();
    setTimeout(() => setDaemonMeta('daemon_console_url', 'http://127.0.0.1:47821'), 600);
  });
  const pending = startDaemon();
  await vi.advanceTimersByTimeAsync(200);
  assert.equal(getDaemonStatus().console_url, null);
  const result = await advance(pending, 400);
  assert.equal(result.console_url, 'http://127.0.0.1:47821');
});

it('times out after ten seconds if the child never acquires', async () => {
  vi.useFakeTimers();
  const result = await advance(startDaemon(), 10000);
  assert.equal(result.code, 'E_DAEMON_START_TIMEOUT');
});

it('returns stopped false when no daemon is running', async () => {
  assert.deepEqual(await stopDaemon(), { headline: ['daemon 当前已停止'], stopped: false, running: false });
  assert.equal(killDaemonProcess.mock.calls.length, 0);
});

it('requests cooperative shutdown and waits for release', async () => {
  await activeLease();
  vi.useFakeTimers();
  setTimeout(() => run("DELETE FROM leases WHERE scope = 'daemon'"), 700);
  const result = await advance(stopDaemon(), 1000);
  assert.equal(result.stopped, true);
  assert.equal(result.forced, undefined);
  assert.equal(killDaemonProcess.mock.calls.length, 0);
});

it('force kills a same-host live lease and deletes only its owner row', async () => {
  await activeLease();
  vi.useFakeTimers();
  const result = await advance(stopDaemon(), 15000);
  assert.equal(result.forced, true);
  assert.deepEqual(killDaemonProcess.mock.calls, [[12345]]);
  assert.equal(readDaemonLease(), null);
  assert.equal(getDaemonMeta('daemon_console_url'), null);
});

it('rejects foreign-host force stop with safe detail', async () => {
  await activeLease('foreign-host');
  vi.useFakeTimers();
  const result = await advance(stopDaemon(), 15000);
  assert.equal(result.code, 'E_DAEMON_STOP_TIMEOUT');
  assert.deepEqual(result.detail, { reason: 'foreign_host' });
  assert.equal(killDaemonProcess.mock.calls.length, 0);
});

it('preserves a replacement owner when stopping races with takeover', async () => {
  await activeLease();
  vi.useFakeTimers();
  setTimeout(() => run("UPDATE leases SET owner_token = 'replacement' WHERE scope = 'daemon'"), 500);
  const result = await advance(stopDaemon(), 15000);
  assert.equal(result.code, 'E_DAEMON_STOP_TIMEOUT');
  assert.equal(readDaemonOwnerToken(), 'replacement');
  assert.equal(killDaemonProcess.mock.calls.length, 0);
});

it('does not kill an expired heartbeat lease', async () => {
  await activeLease();
  vi.useFakeTimers();
  run("UPDATE leases SET expires_at = ? WHERE scope = 'daemon'", new Date(Date.now() + 700).toISOString());
  const result = await advance(stopDaemon(), 1000);
  assert.equal(result.stopped, true);
  assert.equal(killDaemonProcess.mock.calls.length, 0);
});

it('keeps the lease on kill failure and sanitizes the error', async () => {
  await activeLease();
  killDaemonProcess.mockImplementation(() => { throw new Error('private path'); });
  vi.useFakeTimers();
  const result = await advance(stopDaemon(), 15000);
  assert.equal(result.code, 'E_DAEMON_STOP_TIMEOUT');
  assert.deepEqual(result.detail, { pid: 12345, reason: 'kill_failed' });
  assert.equal(readDaemonLease().running, true);
});

function spawnPublishes() {
  spawnDaemonProcess.mockImplementation(() => { setTimeout(async () => {
    await acquireDaemonLease();
    setDaemonMeta('daemon_console_url', 'http://127.0.0.1:47822');
  }, 300); });
}

it('restart starts a stopped daemon without killing anything', async () => {
  vi.useFakeTimers();
  spawnPublishes();
  const result = await advance(restartDaemon(), 400);
  assert.deepEqual([result.headline, result.restarted, result.started], [['daemon 已启动'], false, true]);
  assert.equal(killDaemonProcess.mock.calls.length, 0);
  assert.equal(spawnDaemonProcess.mock.calls.length, 1);
});

it('restart stops the running daemon cooperatively and spawns a fresh one', async () => {
  await activeLease();
  vi.useFakeTimers();
  setTimeout(() => run("DELETE FROM leases WHERE scope = 'daemon'"), 700);
  spawnPublishes();
  const result = await advance(restartDaemon(), 2000);
  assert.deepEqual([result.headline, result.restarted, result.started], [['daemon 已重启'], true, true]);
  assert.equal(result.forced, undefined);
  assert.equal(result.console_url, 'http://127.0.0.1:47822');
  assert.equal(killDaemonProcess.mock.calls.length, 0);
  assert.equal(spawnDaemonProcess.mock.calls.length, 1);
});
