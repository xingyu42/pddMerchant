import { afterEach, beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';

const runtime = vi.hoisted(() => ({ states: [], outcome: null, warn: vi.fn() }));
vi.mock('node:fs/promises', () => ({
  writeFile: async (_path, text) => { runtime.states.push(JSON.parse(text)); },
  readFile: async () => '{}', mkdir: async () => {}, rename: async () => {},
}));
vi.mock('../src/infra/config.js', () => ({ loadRuntimeConfig: async () => ({ refreshIntervalMs: 600000, refreshJitterMs: 120000 }) }));
vi.mock('../src/infra/logger.js', () => ({ createLogger: () => ({ debug() {}, info() {}, warn: runtime.warn, error() {}, fatal() {} }) }));
vi.mock('../src/infra/paths.js', () => ({ AUTH_STATE_PATH: 'synthetic/auth', DAEMON_STATE_PATH: 'synthetic/daemon', accountAuthStatePath: () => 'synthetic/auth' }));
vi.mock('../src/adapter/auth-refresher.js', () => ({ refreshAuth: async () => runtime.outcome }));
vi.mock('../src/adapter/browser.js', () => ({ closeAllBrowsers: async () => {} }));
vi.mock('../src/infra/account-registry.js', () => ({ loadAccountRegistry: async () => ({}), listAccounts: async () => [{ slug: 'synthetic' }], upsertAccount: async () => {} }));
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); runtime.states = []; runtime.warn.mockClear();
  vi.stubEnv('PDD_DAEMON_STARTUP_ATTEMPT', 'synthetic-attempt');
  const originalOn = process.on;
  vi.spyOn(process, 'on').mockImplementation(function (event, handler) {
    return event === 'SIGTERM' || event === 'SIGINT' ? this : originalOn.call(this, event, handler);
  });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it.each(['auth_valid', 'auth_expired', 'auth_check_inconclusive'])('daemon preserves %s and only expiry requests login', async (reason) => {
  runtime.outcome = { success: reason === 'auth_valid', reason };
  await import('../bin/pdd-daemon.js');
  await vi.waitFor(() => assert.equal(runtime.states.length, 2));
  const last = runtime.states.at(-1);
  assert.equal(last.accounts.synthetic.lastResult, reason);
  assert.equal(last.startupAttempt, 'synthetic-attempt');
  const asksLogin = runtime.warn.mock.calls.some((args) => args.some((arg) => typeof arg === 'string' && arg.includes('manual re-login')));
  assert.equal(asksLogin, reason === 'auth_expired');
});
