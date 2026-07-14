import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { chromium } from 'patchright';
import {
  closeAllBrowsers,
  closeBrowser,
  createConsumerContext,
  launchBrowser,
} from '../../src/adapter/browser.js';

function fakeContext({ pageError } = {}) {
  const page = { close: vi.fn(async () => {}) };
  return {
    context: {
      addInitScript: vi.fn(async () => {}),
      newPage: vi.fn(async () => {
        if (pageError) throw pageError;
        return page;
      }),
      close: vi.fn(async () => {}),
    },
    page,
  };
}

function fakeBrowserRuntime(contexts) {
  const createdContexts = [];
  const contextOptions = [];
  let nextContext = 0;
  const browser = {
    version: vi.fn(async () => '136.0.7103.114'),
    newContext: vi.fn(async (options) => {
      const entry = contexts[nextContext++];
      contextOptions.push(options);
      createdContexts.push(entry.context);
      return entry.context;
    }),
    contexts: vi.fn(() => createdContexts),
    close: vi.fn(async () => {}),
  };
  return { browser, contextOptions };
}

afterEach(async () => {
  await closeAllBrowsers();
  vi.restoreAllMocks();
});

describe('createConsumerContext runtime profile inheritance', () => {
  it('inherits the fixed Headless profile and installs the script before its page', async () => {
    const merchant = fakeContext();
    const consumerRuntime = fakeContext();
    const runtime = fakeBrowserRuntime([merchant, consumerRuntime]);
    vi.spyOn(chromium, 'launch').mockResolvedValue(runtime.browser);

    const launched = await launchBrowser();
    const consumer = await createConsumerContext(launched.browser);

    assert.deepEqual(runtime.contextOptions[1], runtime.contextOptions[0]);
    assert.notStrictEqual(runtime.contextOptions[1], runtime.contextOptions[0]);
    assert.equal(consumerRuntime.context.addInitScript.mock.calls.length, 1);
    assert.ok(
      consumerRuntime.context.addInitScript.mock.invocationCallOrder[0]
        < consumerRuntime.context.newPage.mock.invocationCallOrder[0],
    );
    await consumer.close();
    await closeBrowser(launched.browser);
  });

  it('adds storageState and proxy only to the fresh consumer Context', async () => {
    const merchant = fakeContext();
    const consumerRuntime = fakeContext();
    const runtime = fakeBrowserRuntime([merchant, consumerRuntime]);
    vi.spyOn(chromium, 'launch').mockResolvedValue(runtime.browser);
    const proxy = { server: 'http://127.0.0.1:8080' };

    const launched = await launchBrowser();
    const consumer = await createConsumerContext(launched.browser, {
      storageStatePath: process.execPath,
      proxy,
    });

    assert.equal(runtime.contextOptions[0].proxy, undefined);
    assert.equal(runtime.contextOptions[0].storageState, undefined);
    assert.deepEqual(runtime.contextOptions[1].proxy, proxy);
    assert.equal(runtime.contextOptions[1].storageState, process.execPath);
    await consumer.close();
    await closeBrowser(launched.browser);
  });

  it('inherits natural headed settings without UA or init-script overrides', async () => {
    const merchant = fakeContext();
    const consumerRuntime = fakeContext();
    const runtime = fakeBrowserRuntime([merchant, consumerRuntime]);
    vi.spyOn(chromium, 'launch').mockResolvedValue(runtime.browser);

    const launched = await launchBrowser({ headed: true });
    const consumer = await createConsumerContext(launched.browser);

    assert.deepEqual(runtime.contextOptions, [{ viewport: null }, { viewport: null }]);
    assert.equal(consumerRuntime.context.addInitScript.mock.calls.length, 0);
    await consumer.close();
    await closeBrowser(launched.browser);
  });

  it('closes a partially-created consumer Context without closing the shared browser', async () => {
    const pageError = new Error('page init failed');
    const merchant = fakeContext();
    const consumerRuntime = fakeContext({ pageError });
    const runtime = fakeBrowserRuntime([merchant, consumerRuntime]);
    vi.spyOn(chromium, 'launch').mockResolvedValue(runtime.browser);
    const launched = await launchBrowser();

    await assert.rejects(() => createConsumerContext(launched.browser), (err) => err === pageError);

    assert.ok(consumerRuntime.context.close.mock.calls.length >= 1);
    assert.equal(runtime.browser.close.mock.calls.length, 0);
    await closeBrowser(launched.browser);
  });
});
