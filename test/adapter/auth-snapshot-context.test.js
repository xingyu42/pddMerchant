import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

async function setupBrowser() {
  vi.resetModules();
  vi.stubEnv('PDD_TEST_ADAPTER', '');
  const contexts = [];
  const browser = {
    version: vi.fn(async () => '136.0.1'), close: vi.fn(async () => {}),
    contexts: () => contexts,
    newContext: vi.fn(async () => {
      const context = { newPage: vi.fn(async () => ({})), addInitScript: vi.fn(async () => {}), close: vi.fn(async () => {}) };
      contexts.push(context);
      return context;
    }),
  };
  vi.doMock('patchright', () => ({ chromium: { launch: vi.fn(async () => browser) } }));
  const runtime = await import('../../src/adapter/browser.js');
  await runtime.launchBrowser();
  return { browser, runtime, contexts };
}

describe('frozen authentication context', () => {
  it('copies standard storage fields without passing merchant metadata to the browser', async () => {
    const { browser, runtime } = await setupBrowser();
    try {
      const state = { cookies: [{ name: 'PASS_ID', value: 'synthetic' }], origins: [], merchant_auth: { mallId: '900001' } };
      const context = await runtime.createSnapshotContext(browser, state);
      const options = browser.newContext.mock.calls[1][0];
      assert.deepEqual(Object.keys(options.storageState).sort(), ['cookies', 'origins']);
      state.cookies[0].value = 'changed';
      assert.equal(options.storageState.cookies[0].value, 'synthetic');
      assert.equal(context.addInitScript.mock.calls.length, 1);
      await context.close();
    } finally { await runtime.closeBrowser(browser); vi.doUnmock('patchright'); }
  });

  it('rejects malformed snapshots and unknown browser owners without creating contexts', async () => {
    const { browser, runtime } = await setupBrowser();
    try {
      await assert.rejects(runtime.createSnapshotContext(browser, { cookies: [] }), (error) => error.code === 'E_BROWSER_RUNTIME');
      await assert.rejects(runtime.createSnapshotContext({}, { cookies: [], origins: [] }), (error) => error.code === 'E_BROWSER_RUNTIME');
      assert.equal(browser.newContext.mock.calls.length, 1);
    } finally { await runtime.closeBrowser(browser); vi.doUnmock('patchright'); }
  });

  it('closes a partial context when consistency initialization fails', async () => {
    const { browser, runtime } = await setupBrowser();
    const failure = new Error('synthetic init failure');
    const broken = { addInitScript: vi.fn(async () => { throw failure; }), close: vi.fn(async () => {}) };
    browser.newContext.mockResolvedValueOnce(broken);
    try {
      await assert.rejects(runtime.createSnapshotContext(browser, { cookies: [], origins: [] }), (error) => error === failure);
      assert.equal(broken.close.mock.calls.length, 1);
    } finally { await runtime.closeBrowser(browser); vi.doUnmock('patchright'); }
  });
});
