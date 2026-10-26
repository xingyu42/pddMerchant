import { afterEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';

const state = vi.hoisted(() => ({ fixture: false }));
const log = vi.hoisted(() => ({ warn() {}, debug() {}, info() {}, error() {} }));
vi.mock('../../../../src/infra/logger.js', () => ({ getLogger: () => log }));
vi.mock('../../../../src/infra/account-resolver.js', () => ({
  resolveAccountContext: async () => null,
  accountMetaForEnvelope: () => ({}),
}));
vi.mock('../../../../src/infra/paths.js', () => ({ AUTH_STATE_PATH: 'synthetic-only' }));
vi.mock('../../../../src/adapter/browser.js', () => ({
  withBrowser: async (_options, fn) => fn({ context: {}, page: {} }),
}));
vi.mock('../../../../src/adapter/auth-state.js', () => ({
  getAuthStateRevision: async () => null,
  isAuthValid: async () => true,
  saveAuthStateIfCurrent: async () => ({ saved: true }),
}));
vi.mock('../../../../src/adapter/mall-reader.js', () => ({ resolveMallContext: async () => null }));
vi.mock('../../../../src/adapter/mall-writer.js', () => ({ switchTo: async () => {} }));
vi.mock('../../../../src/adapter/rate-limiter-singleton.js', () => ({ getSharedClient: () => ({}) }));
vi.mock('../../../../src/adapter/page-session.js', () => ({
  createPageSession: () => ({ closeAll: async () => {} }),
}));
vi.mock('../../../../src/infra/daemon-launcher.js', () => ({
  ensureDaemonRunning: () => { throw new Error('daemon must not start'); },
}));
vi.mock('../../../../src/adapter/mock-dispatcher.js', () => ({
  isMockEnabled: () => state.fixture,
  FixtureEndpointClient: class {},
  mockCurrentMall: async () => null,
  mockListMalls: async () => [],
}));
vi.mock('../../../../src/commands/runner/envelope-finalizer.js', () => ({
  finalizeSuccess: (_spec, _runtime, result) => ({ ok: true, data: result }),
  finalizeError: (_spec, _runtime, error) => ({ ok: false, error }),
}));

const { executeSingle } = await import('../../../../src/commands/runner/single-lifecycle.js');
const { abortableSleep } = await import('../../../../src/infra/abort.js');
afterEach(() => vi.useRealTimers());

it('F1: live deadline is cleared while signal-aware work is still pending', async () => {
  vi.useFakeTimers();
  state.fixture = false;
  let signal;
  const promise = executeSingle({
    name: 'audit.timeout', needsAuth: false, needsMall: 'none',
    async run(ctx) {
      signal = ctx.signal;
      await abortableSleep(100, ctx.signal);
      return { expired: Date.now() >= ctx.deadlineAt };
    },
  }, { timeoutMs: 10 }, { emitResult: false, skipDaemonStart: true });
  await vi.advanceTimersByTimeAsync(100);
  const result = await promise;
  assert.equal(signal.aborted, false);
  assert.deepEqual(result, { ok: true, data: { expired: true } });
});

it('F1 control: equivalent fixture work receives the timeout signal', async () => {
  vi.useFakeTimers();
  state.fixture = true;
  const promise = executeSingle({
    name: 'audit.timeout.control', needsAuth: false, needsMall: 'none',
    async run(ctx) { await abortableSleep(100, ctx.signal); },
  }, { timeoutMs: 10 }, { emitResult: false, skipDaemonStart: true });
  await vi.advanceTimersByTimeAsync(100);
  assert.equal((await promise).error.code, 'E_TIMEOUT');
});
