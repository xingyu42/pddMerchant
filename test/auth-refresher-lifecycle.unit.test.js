import { afterEach, beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const runtime = vi.hoisted(() => ({
  page: null, save: vi.fn(async () => {}), capture: vi.fn(async () => { throw new Error('no QR'); }),
  acquire: vi.fn(async () => ({ token: 'test' })), release: vi.fn(async () => {}),
}));
vi.mock('../src/adapter/mock-dispatcher.js', () => ({ isMockEnabled: () => false }));
vi.mock('../src/adapter/browser.js', () => ({ withBrowser: async (_opts, fn) => fn({ context: {}, page: runtime.page }) }));
vi.mock('../src/adapter/auth-state.js', () => ({ saveAuthState: runtime.save }));
vi.mock('../src/infra/auth-lock.js', () => ({ acquireLock: runtime.acquire, releaseLock: runtime.release }));
vi.mock('../src/adapter/qr-login.js', () => ({ captureQrElement: runtime.capture, saveQrPng: async () => '' }));
vi.mock('../src/infra/timeouts.js', () => ({ TIMEOUTS: { AUTH_REFRESH: 100, QR_CAPTURE: 100 } }));
const { refreshAuth } = await import('../src/adapter/auth-refresher.js');
const log = { debug() {}, info() {}, warn() {}, error() {} };
let root;
let authStatePath;
function response(login, { status = 200, method = 'POST', url = 'https://mms.pinduoduo.com/janus/api/checkLogin', malformed = false } = {}) {
  return {
    url: () => url, status: () => status, request: () => ({ method: () => method }),
    json: async () => {
      if (malformed) throw new Error('invalid JSON');
      return { success: false, errorCode: 1000000, result: { login } };
    },
  };
}
function pageWith(navigate) {
  const page = new EventEmitter();
  page.url = () => 'https://mms.pinduoduo.com/home';
  page.mainFrame = () => page;
  page.goto = async () => {
    assert.equal(page.listenerCount('response'), 1);
    await navigate(page);
  };
  return page;
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pdd-refresh-test-'));
  authStatePath = join(root, 'auth.json');
  await writeFile(authStatePath, '{"cookies":[],"origins":[]}');
  vi.clearAllMocks();
});
afterEach(async () => { vi.useRealTimers(); await rm(root, { recursive: true, force: true }); });
async function run(navigate) {
  runtime.page = pageWith(navigate);
  const result = await refreshAuth({ authStatePath, log });
  assert.equal(runtime.page.listenerCount('response'), 0);
  assert.equal(runtime.page.listenerCount('framenavigated'), 0);
  assert.equal(runtime.release.mock.calls.length, 1);
  return result;
}
it.each([true, false])('uses boolean login=%s regardless of outer success code', async (login) => {
  const result = await run((page) => page.emit('response', response(login)));
  assert.equal(result.reason, login ? 'auth_valid' : 'auth_expired');
  assert.equal(runtime.save.mock.calls.length, login ? 1 : 0);
});
it.each([[undefined, {}], ['true', {}], [true, { status: 403 }], [true, { malformed: true }]])('preserves inconclusive state (%s, %j)', async (login, options) => {
  const result = await run((page) => page.emit('response', response(login, options)));
  assert.equal(result.reason, 'auth_check_inconclusive');
  assert.equal(runtime.save.mock.calls.length, 0);
  assert.equal(runtime.capture.mock.calls.length, 0);
  assert.equal(await readFile(authStatePath, 'utf8'), '{"cookies":[],"origins":[]}');
});
it('ignores unrelated host, path and method responses', async () => {
  const result = await run((page) => {
    page.emit('response', response(false, { method: 'GET' }));
    page.emit('response', response(false, { url: 'https://example.test/janus/api/checkLogin' }));
    page.emit('response', response(false, { url: 'https://mms.pinduoduo.com/other' }));
    page.emit('response', response(true));
  });
  assert.equal(result.reason, 'auth_valid');
});
it('times out without saving or requesting QR', async () => {
  vi.useFakeTimers();
  const pending = run(() => {});
  await vi.advanceTimersByTimeAsync(101);
  assert.equal((await pending).reason, 'auth_check_inconclusive');
  assert.equal(vi.getTimerCount(), 0);
  assert.equal(runtime.save.mock.calls.length, 0);
  assert.equal(runtime.capture.mock.calls.length, 0);
});
it.each(['/login/', '/login.html'])('recognizes main-frame %s navigation as expiry', async (path) => {
  const result = await run((page) => {
    page.url = () => `https://mms.pinduoduo.com${path}`; page.emit('framenavigated', page);
  });
  assert.equal(result.reason, 'auth_expired');
  assert.equal(runtime.save.mock.calls.length, 0);
});
it('disposes the observer on navigation failure', async () => {
  assert.equal((await run(() => { throw new Error('navigation failed'); })).reason, 'auth_check_inconclusive');
});
it('does not save after abort', async () => {
  const controller = new AbortController();
  runtime.page = pageWith((page) => { page.emit('response', response(true)); controller.abort(); });
  const result = await refreshAuth({ authStatePath, log, signal: controller.signal });
  assert.equal(result.reason, 'aborted');
  assert.equal(runtime.save.mock.calls.length, 0);
  assert.equal(runtime.page.listenerCount('response'), 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
it('ignores iframe login navigation', async () => {
  const result = await run((page) => {
    page.emit('framenavigated', { url: () => 'https://mms.pinduoduo.com/login/' });
    page.emit('response', response(true));
  });
  assert.equal(result.reason, 'auth_valid');
});
it('ignores a body that resolves after the observation deadline', async () => {
  vi.useFakeTimers();
  let finishBody;
  const pending = run((page) => page.emit('response', {
    ...response(true), json: () => new Promise((resolve) => { finishBody = resolve; }),
  }));
  await vi.advanceTimersByTimeAsync(101);
  assert.equal((await pending).reason, 'auth_check_inconclusive');
  finishBody({ result: { login: true } });
  await Promise.resolve();
  assert.equal(runtime.save.mock.calls.length, 0);
});
it('preserves state when locking fails', async () => {
  runtime.acquire.mockRejectedValueOnce(new Error('busy'));
  assert.equal((await refreshAuth({ authStatePath, log })).reason, 'lock_timeout');
  assert.equal(runtime.save.mock.calls.length, 0);
  assert.equal(runtime.release.mock.calls.length, 0);
  assert.equal(await readFile(authStatePath, 'utf8'), '{"cookies":[],"origins":[]}');
});
