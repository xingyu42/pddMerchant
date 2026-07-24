import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tempRoots = [];

async function tempAuthPath() {
  const root = await mkdtemp(join(tmpdir(), 'pdd-auth-refresher-'));
  tempRoots.push(root);
  return join(root, 'auth-state.json');
}

async function importRefreshAuthWithLockFailure() {
  vi.resetModules();
  vi.doMock('../src/infra/auth-lock.js', () => ({
    acquireLock: async () => {
      throw new Error('lock busy');
    },
    releaseLock: async () => true,
  }));
  vi.doMock('../src/adapter/browser.js', () => ({
    evaluateInMainWorld: (page, pageFunction, arg) => page.evaluate(pageFunction, arg, false),
    withBrowser: async () => {
      throw new Error('browser must not be launched when lock acquisition fails');
    },
  }));
  return import('../src/adapter/auth-refresher.js');
}

async function importRefreshAuthWithRuntime({
  heartbeatResult,
  pageUrl = 'https://mms.pinduoduo.com/home',
  fullValidation = false,
}) {
  vi.resetModules();
  const saveAuthState = vi.fn(async () => '/tmp/auth-state.json');
  const isAuthValid = vi.fn(async () => fullValidation);
  const evaluateInMainWorld = vi.fn(async () => heartbeatResult);

  vi.doMock('../src/infra/auth-lock.js', () => ({
    acquireLock: async () => ({ token: 'test-lock' }),
    releaseLock: async () => true,
  }));
  vi.doMock('../src/adapter/browser.js', () => ({
    evaluateInMainWorld,
    withBrowser: async (_options, fn) => fn({
      context: { storageState: async () => ({ cookies: [], origins: [] }) },
      page: {
        goto: async () => {},
        url: () => pageUrl,
      },
    }),
  }));
  vi.doMock('../src/adapter/auth-state.js', () => ({
    isAuthValid,
    saveAuthState,
  }));
  vi.doMock('../src/adapter/qr-login.js', () => ({
    captureQrElement: async () => { throw new Error('qr unavailable'); },
    saveQrPng: async () => '/tmp/qr.png',
  }));

  return {
    authRefresher: await import('../src/adapter/auth-refresher.js'),
    evaluateInMainWorld,
    isAuthValid,
    saveAuthState,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    await rm(root, { recursive: true, force: true });
  }
});

describe('auth refresher lifecycle invariants', () => {
  it('does not overwrite existing auth-state when lock acquisition fails', async () => {
    const authStatePath = await tempAuthPath();
    const originalState = JSON.stringify({
      cookies: [{ name: 'sid', value: 'keep-me', domain: '.example.test', path: '/' }],
      origins: [],
    }, null, 2);
    await writeFile(authStatePath, originalState);

    const { refreshAuth } = await importRefreshAuthWithLockFailure();
    const result = await refreshAuth({
      authStatePath,
      log: {
        warn() {},
        error() {},
        info() {},
        debug() {},
      },
    });

    assert.equal(result.success, false);
    assert.equal(result.reason, 'lock_timeout');
    assert.equal(await readFile(authStatePath, 'utf8'), originalState);
  });

  it('does not treat a followed login redirect with final 200 as heartbeat success', async () => {
    const authStatePath = await tempAuthPath();
    await writeFile(authStatePath, '{"cookies":[],"origins":[]}');
    const runtime = await importRefreshAuthWithRuntime({
      heartbeatResult: {
        status: 200,
        ok: true,
        redirected: true,
        url: 'https://mms.pinduoduo.com/login/?redirectUrl=%2Fhome',
      },
      fullValidation: false,
    });

    const result = await runtime.authRefresher.refreshAuth({ authStatePath });

    assert.equal(result.success, false);
    assert.equal(result.reason, 'auth_expired');
    assert.equal(runtime.isAuthValid.mock.calls.length, 1);
    assert.equal(runtime.saveAuthState.mock.calls.length, 0);
  });

  it.each([401, 403])('falls back to full validation after heartbeat status %s', async (status) => {
    const authStatePath = await tempAuthPath();
    await writeFile(authStatePath, '{"cookies":[],"origins":[]}');
    const runtime = await importRefreshAuthWithRuntime({
      heartbeatResult: {
        status,
        ok: false,
        redirected: false,
        url: 'https://mms.pinduoduo.com/janus/api/informSeller/queryInformSellerTabList',
      },
      fullValidation: false,
    });

    const result = await runtime.authRefresher.refreshAuth({ authStatePath });

    assert.equal(result.success, false);
    assert.equal(result.reason, 'auth_expired');
    assert.equal(runtime.isAuthValid.mock.calls.length, 1);
    assert.equal(runtime.saveAuthState.mock.calls.length, 0);
  });

  it('does not run heartbeat when home navigation already ends on the login page', async () => {
    const authStatePath = await tempAuthPath();
    await writeFile(authStatePath, '{"cookies":[],"origins":[]}');
    const runtime = await importRefreshAuthWithRuntime({
      heartbeatResult: {
        status: 200,
        ok: true,
        redirected: false,
        url: 'https://mms.pinduoduo.com/janus/api/informSeller/queryInformSellerTabList',
      },
      pageUrl: 'https://mms.pinduoduo.com/login/?redirectUrl=%2Fhome',
      fullValidation: false,
    });

    const result = await runtime.authRefresher.refreshAuth({ authStatePath });

    assert.equal(result.success, false);
    assert.equal(result.reason, 'auth_expired');
    assert.equal(runtime.evaluateInMainWorld.mock.calls.length, 0);
    assert.equal(runtime.isAuthValid.mock.calls.length, 1);
    assert.equal(runtime.saveAuthState.mock.calls.length, 0);
  });

  it('falls back to full validation and saves cookies when redirected heartbeat is still valid', async () => {
    const authStatePath = await tempAuthPath();
    await writeFile(authStatePath, '{"cookies":[],"origins":[]}');
    const runtime = await importRefreshAuthWithRuntime({
      heartbeatResult: {
        status: 200,
        ok: true,
        redirected: true,
        url: 'https://mms.pinduoduo.com/login/?redirectUrl=%2Fhome',
      },
      fullValidation: true,
    });

    const result = await runtime.authRefresher.refreshAuth({ authStatePath });

    assert.deepEqual(result, { success: true, reason: 'refreshed' });
    assert.equal(runtime.isAuthValid.mock.calls.length, 1);
    assert.equal(runtime.saveAuthState.mock.calls.length, 1);
  });

  it('saves cookies directly after a non-redirected successful heartbeat', async () => {
    const authStatePath = await tempAuthPath();
    await writeFile(authStatePath, '{"cookies":[],"origins":[]}');
    const runtime = await importRefreshAuthWithRuntime({
      heartbeatResult: {
        status: 200,
        ok: true,
        redirected: false,
        url: 'https://mms.pinduoduo.com/janus/api/informSeller/queryInformSellerTabList',
      },
    });

    const result = await runtime.authRefresher.refreshAuth({ authStatePath });

    assert.deepEqual(result, { success: true, reason: 'refreshed' });
    assert.equal(runtime.isAuthValid.mock.calls.length, 0);
    assert.equal(runtime.saveAuthState.mock.calls.length, 1);
  });
});
