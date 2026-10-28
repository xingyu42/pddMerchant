import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { beforeEach, it, vi } from 'vitest';
import { cleanupOrphanBrowsers, closeAllBrowsers } from '../../src/adapter/browser.js';
import { runDaemon } from '../../src/daemon/run.js';
import { daemonTimings } from '../../src/services/daemon-runtime.js';
import {
  acquireDaemonLease, readDaemonLease, readDaemonStopRequest, requestDaemonStop, readDaemonOwnerToken, DAEMON_LEASE,
} from '../../src/infra/daemon-state.js';
import { run, get, getDatabasePath } from '../../src/infra/db.js';

vi.mock('../../src/adapter/browser.js', () => ({ cleanupOrphanBrowsers: vi.fn(() => 0), closeAllBrowsers: vi.fn(async () => {}) }));
beforeEach(() => { cleanupOrphanBrowsers.mockClear(); closeAllBrowsers.mockReset().mockResolvedValue(undefined); });

function component(overrides = {}) {
  return { start: vi.fn(async () => {}), stop: vi.fn(async () => {}), ...overrides };
}

function options(components = []) { return { foreground: false, runtimeConfig: { logLevel: 'silent' }, components }; }

it('returns already_running without starting components or clearing another owner stop request', async () => {
  await acquireDaemonLease();
  requestDaemonStop();
  const part = component();
  assert.deepEqual(await runDaemon(options([part])), { status: 'already_running' });
  assert.equal(part.start.mock.calls.length, 0);
  assert.ok(readDaemonStopRequest());
});

it('clears stale stop requests, heartbeats, purges rows and cleans components in reverse order', async () => {
  vi.useFakeTimers();
  requestDaemonStop();
  const order = [];
  const first = component({ start: vi.fn(async (ctx) => {
    assert.match(ctx.ownerTag, /^[a-z0-9-]{1,32}$/);
    const db8 = createHash('sha256').update(resolve(getDatabasePath())).digest('hex').slice(0, 8);
    assert.equal(ctx.ownerTag, `${db8}-${readDaemonOwnerToken().slice(0, 23)}`);
    assert.equal(readDaemonStopRequest(), null);
    assert.equal(cleanupOrphanBrowsers.mock.calls.length, 1);
  }), stop: vi.fn(async () => { order.push('first'); }) });
  const second = component({ stop: vi.fn(async () => { order.push('second'); }) });
  run("INSERT INTO console_tokens VALUES ('old', NULL, ?, ?, NULL)", new Date().toISOString(), new Date().toISOString());
  const pending = runDaemon(options([first, second]));
  await vi.advanceTimersByTimeAsync(0);
  const acquiredAt = readDaemonLease().heartbeat_at;
  await vi.advanceTimersByTimeAsync(DAEMON_LEASE.heartbeatMs);
  assert.notEqual(readDaemonLease().heartbeat_at, acquiredAt);
  assert.equal(get('SELECT COUNT(*) AS count FROM console_tokens').count, 0);
  requestDaemonStop();
  await vi.advanceTimersByTimeAsync(DAEMON_LEASE.heartbeatMs);
  assert.deepEqual(await pending, { stopped_reason: 'stop_request' });
  assert.deepEqual(order, ['second', 'first']);
  assert.equal(readDaemonLease(), null);
  assert.equal(readDaemonStopRequest(), null);
  assert.equal(closeAllBrowsers.mock.calls.length, 1);
});

it('notices a stop request well within the 15 s stop budget instead of waiting for the 30 s heartbeat', async () => {
  vi.useFakeTimers();
  const pending = runDaemon(options());
  await vi.advanceTimersByTimeAsync(0);
  requestDaemonStop();
  await vi.advanceTimersByTimeAsync(1000);
  assert.deepEqual(await pending, { stopped_reason: 'stop_request' });
  assert.equal(readDaemonLease(), null);
  assert.equal(readDaemonStopRequest(), null);
  assert.equal(vi.getTimerCount(), 0);
});

it('stops immediately on lease loss and leaves the replacement stop request intact', async () => {
  vi.useFakeTimers();
  const part = component();
  const pending = runDaemon(options([part]));
  await vi.advanceTimersByTimeAsync(0);
  run("UPDATE leases SET owner_token = 'new-owner' WHERE scope = 'daemon'");
  requestDaemonStop();
  await vi.advanceTimersByTimeAsync(DAEMON_LEASE.heartbeatMs);
  assert.deepEqual(await pending, { stopped_reason: 'lease_lost' });
  assert.equal(part.stop.mock.calls.length, 1);
  assert.ok(readDaemonStopRequest());
  assert.equal(readDaemonLease().running, true);
});

it.each(['SIGINT', 'SIGTERM', process.platform === 'win32' ? 'SIGBREAK' : 'SIGHUP'])('handles %s and removes its listeners', async (name) => {
  vi.useFakeTimers();
  const before = process.listenerCount(name);
  const pending = runDaemon(options());
  await vi.advanceTimersByTimeAsync(0);
  process.emit(name);
  assert.deepEqual(await pending, { stopped_reason: 'signal' });
  assert.equal(process.listenerCount(name), before);
  assert.equal(vi.getTimerCount(), 0);
});

it('handles an injected abort signal during component startup', async () => {
  const controller = new AbortController();
  const part = component({ start: async () => { controller.abort(); await new Promise(() => {}); } });
  assert.deepEqual(await runDaemon({ ...options([part]), signal: controller.signal }), { stopped_reason: 'signal' });
  assert.equal(part.stop.mock.calls.length, 1);
});

it('releases on partial startup failure and still stops later components after a stop error', async () => {
  const first = component({ stop: async () => { throw new Error('stop'); } });
  const second = component({ start: async () => { throw new Error('start'); } });
  await assert.rejects(runDaemon(options([first, second])), /start/);
  assert.equal(second.stop.mock.calls.length, 1);
  assert.equal(readDaemonLease(), null);
});

it('forces exit after five seconds when graceful cleanup hangs', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const exit = vi.fn();
  const part = component({ stop: () => new Promise(() => {}) });
  const pending = runDaemon({ ...options([part]), signal: controller.signal, exit });
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await vi.advanceTimersByTimeAsync(4999);
  assert.equal(exit.mock.calls.length, 0);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(exit.mock.calls.length, 1);
  assert.equal((await pending).stopped_reason, 'signal');
});

it('closes browsers before releasing the lease even when browser close fails', async () => {
  const controller = new AbortController();
  closeAllBrowsers.mockImplementationOnce(async () => {
    assert.equal(readDaemonLease().running, true);
    throw new Error('browser cleanup');
  });
  await assert.rejects(runDaemon({ ...options([component({ start: async () => controller.abort() })]),
    signal: controller.signal }), /browser cleanup/);
  assert.equal(readDaemonLease(), null);
});

it('foreground logging writes redacted diagnostics to stderr through the daemon logger', async () => {
  const controller = new AbortController();
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const part = component({ start: async (ctx) => {
    ctx.log.info({ consoleToken: 'private-token' }, 'test foreground daemon');
    controller.abort();
  } });
  await runDaemon({ foreground: true, signal: controller.signal, components: [part] });
  const output = stderr.mock.calls.map(([chunk]) => chunk).join('');
  assert.match(output, /test foreground daemon/);
  assert.equal(output.includes('private-token'), false);
});

it('accepts positive fixture timing overrides and ignores them outside fixture mode', () => {
  vi.stubEnv('PDD_TEST_DAEMON_LEASE_TTL_MS', '500');
  vi.stubEnv('PDD_TEST_DAEMON_HEARTBEAT_MS', '50');
  assert.deepEqual(daemonTimings(), { ttlMs: 500, heartbeatMs: 50 });
  vi.stubEnv('PDD_TEST_ADAPTER', '');
  assert.deepEqual(daemonTimings(), { ttlMs: 90000, heartbeatMs: 30000 });
  vi.stubEnv('PDD_TEST_ADAPTER', 'fixture');
  vi.stubEnv('PDD_TEST_DAEMON_LEASE_TTL_MS', '-1');
  vi.stubEnv('PDD_TEST_DAEMON_HEARTBEAT_MS', 'no');
  assert.deepEqual(daemonTimings(), { ttlMs: 90000, heartbeatMs: 30000 });
});
