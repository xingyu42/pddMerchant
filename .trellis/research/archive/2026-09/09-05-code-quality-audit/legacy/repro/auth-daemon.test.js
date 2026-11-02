import { afterEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';

const state = vi.hoisted(() => ({
  stored: { pid: 12345, status: 'running', tokenFingerprint: 'synthetic' },
  alive: false,
  save: vi.fn(async () => {}),
  fullValidation: vi.fn(async () => false),
  spawn: vi.fn(() => ({ pid: 54321, unref() {} })),
  kill: vi.fn(() => { throw new Error('simulated permission denial'); }),
  unlink: vi.fn(async () => {}),
  bodyRead: vi.fn(async () => ({ success: false, result: { login: false } })),
}));
const log = vi.hoisted(() => ({ warn() {}, debug() {}, info() {}, error() {} }));
vi.mock('node:fs', () => ({ existsSync: () => true }));
vi.mock('node:fs/promises', () => ({
  readFile: async () => JSON.stringify(state.stored),
  writeFile: async () => {}, mkdir: async () => {}, unlink: state.unlink,
}));
vi.mock('node:os', () => ({ platform: () => 'win32' }));
vi.mock('node:child_process', () => ({ spawn: state.spawn, execSync: state.kill }));
vi.mock('../../../../src/infra/paths.js', () => ({
  DAEMON_STATE_PATH: 'synthetic/daemon.json', PROJECT_ROOT: 'synthetic',
}));
vi.mock('../../../../src/infra/process-util.js', () => ({ isPidAlive: () => state.alive }));
vi.mock('../../../../src/infra/logger.js', () => ({ getLogger: () => log }));
vi.mock('../../../../src/infra/auth-lock.js', () => ({
  acquireLock: async () => ({ token: 'synthetic' }), releaseLock: async () => {},
}));
vi.mock('../../../../src/infra/output.js', () => ({ buildEnvelope: (value) => value, emit() {} }));
vi.mock('../../../../src/adapter/mock-dispatcher.js', () => ({ isMockEnabled: () => false }));
vi.mock('../../../../src/adapter/auth-state.js', () => ({
  saveAuthState: state.save, isAuthValid: state.fullValidation,
}));
vi.mock('../../../../src/adapter/qr-login.js', () => ({
  captureQrElement: async () => { throw new Error('QR should not be needed'); }, saveQrPng: async () => '',
}));
vi.mock('../../../../src/adapter/browser.js', () => ({
  withBrowser: async (_options, fn) => fn({
    context: {}, page: { goto: async () => {}, url: () => 'https://example.test/home' },
  }),
  evaluateInMainWorld: async (_page, fn, arg) => fn(arg),
}));

const { refreshAuth } = await import('../../../../src/adapter/auth-refresher.js');
const { ensureDaemonRunning } = await import('../../../../src/infra/daemon-launcher.js');
const daemon = await import('../../../../src/commands/daemon.js');
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('F2: HTTP 200 business rejection is never read and state is saved', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    status: 200, ok: true, redirected: false,
    url: 'https://example.test/heartbeat', json: state.bodyRead,
  })));
  const result = await refreshAuth({ authStatePath: 'synthetic/auth.json', log });
  assert.equal(result.success, true);
  assert.equal(state.bodyRead.mock.calls.length, 0);
  assert.equal(state.fullValidation.mock.calls.length, 0);
  assert.equal(state.save.mock.calls.length, 1);
});

it('F3: stale running state with a dead PID confirms a new launch', async () => {
  vi.useFakeTimers();
  state.alive = false;
  const promise = ensureDaemonRunning();
  await vi.advanceTimersByTimeAsync(201);
  assert.deepEqual(await promise, { started: true, pid: 12345 });
  assert.equal(state.spawn.mock.calls.length, 1);
});

it('F4: failed termination still reports stopped and removes the state', async () => {
  vi.useFakeTimers();
  state.alive = true;
  const promise = daemon.stop({ json: true });
  await vi.advanceTimersByTimeAsync(5100);
  const result = await promise;
  assert.equal(result.ok, true);
  assert.equal(result.data.stopped, true);
  assert.equal(state.alive, true);
  assert.equal(state.kill.mock.calls.length, 2);
  assert.equal(state.unlink.mock.calls.length, 1);
});
