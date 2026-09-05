import { afterEach, beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';
const runtime = vi.hoisted(() => ({
  state: null, alive: new Set(), busy: false, onSpawn: () => {},
  spawn: vi.fn((...args) => { runtime.onSpawn(args.at(-1).env); return { pid: 222, unref() {}, once() {} }; }),
}));
vi.mock('node:fs', () => ({ existsSync: () => true }));
vi.mock('node:fs/promises', () => ({
  readFile: async (path) => JSON.stringify(path.endsWith('.lock') ? { pid: 77, createdAt: Date.now() } : runtime.state),
  writeFile: async () => { if (runtime.busy) throw Object.assign(new Error('busy'), { code: 'EEXIST' }); },
  mkdir: async () => {}, unlink: async () => {},
}));
vi.mock('node:child_process', () => ({ spawn: runtime.spawn }));
vi.mock('node:os', () => ({ platform: () => 'win32' }));
vi.mock('../src/infra/paths.js', () => ({ DAEMON_STATE_PATH: 'synthetic/state', PROJECT_ROOT: 'synthetic' }));
vi.mock('../src/infra/process-util.js', () => ({ isPidAlive: (pid) => runtime.alive.has(pid) }));
const { ensureDaemonRunning } = await import('../src/infra/daemon-launcher.js');
beforeEach(() => {
  vi.useFakeTimers();
  runtime.state = { pid: 111, status: 'running', tokenFingerprint: 'old' };
  runtime.alive.clear(); runtime.busy = false; runtime.onSpawn = () => {}; runtime.spawn.mockClear();
});
afterEach(() => vi.useRealTimers());
async function launch() {
  const pending = ensureDaemonRunning(); await vi.advanceTimersByTimeAsync(5100); return pending;
}
it('rejects stale dead running state', async () => {
  assert.equal((await launch()).confirmed, false);
});
it('confirms matching live daemon PID, not the Windows wrapper PID', async () => {
  runtime.onSpawn = (env) => {
    runtime.state = { pid: 333, status: 'running', tokenFingerprint: 'new', startupAttempt: env.PDD_DAEMON_STARTUP_ATTEMPT };
    runtime.alive.add(333);
  };
  assert.deepEqual(await launch(), { started: true, pid: 333 });
});
it('rejects another live attempt', async () => {
  runtime.onSpawn = () => {
    runtime.state = { pid: 333, status: 'running', tokenFingerprint: 'new', startupAttempt: 'other' };
    runtime.alive.add(333);
  };
  assert.equal((await launch()).confirmed, false);
});
it('does not duplicate an unverifiable live process', async () => {
  runtime.state = { pid: 333, status: 'running' }; runtime.alive.add(333);
  assert.equal((await launch()).confirmed, false);
  assert.equal(runtime.spawn.mock.calls.length, 0);
});
it('recognizes an existing live daemon', async () => {
  runtime.alive.add(111);
  assert.deepEqual(await launch(), { started: false, pid: 111 });
  assert.equal(runtime.spawn.mock.calls.length, 0);
});
it('waits for another launcher holding the lock', async () => {
  runtime.busy = true; runtime.alive.add(77);
  setTimeout(() => {
    runtime.state = { pid: 333, status: 'running', tokenFingerprint: 'new' }; runtime.alive.add(333);
  }, 100);
  assert.deepEqual(await launch(), { started: false, pid: 333 });
  assert.equal(runtime.spawn.mock.calls.length, 0);
});
