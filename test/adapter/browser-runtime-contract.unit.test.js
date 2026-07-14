import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { chromium } from 'patchright';
import * as browserAdapter from '../../src/adapter/browser.js';

function fakeBrowserRuntime() {
  const page = { close: vi.fn(async () => {}) };
  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
  };
  const browser = {
    newContext: vi.fn(async () => context),
    contexts: vi.fn(() => [context]),
    close: vi.fn(async () => {}),
  };
  return { browser, context };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('browser runtime adapter contract', () => {
  it('owns the browser executable path lookup for doctor', () => {
    assert.equal(typeof browserAdapter.getBrowserExecutablePath, 'function');
    const executablePath = browserAdapter.getBrowserExecutablePath();
    assert.equal(typeof executablePath, 'string');
    assert.ok(executablePath.length > 0);
  });

  it('preserves Playwright main-world evaluate semantics', async () => {
    const calls = [];
    const page = {
      evaluate: async (...args) => {
        calls.push(args);
        return 'ok';
      },
    };
    const pageFunction = ({ value }) => value;
    const arg = { value: 42 };

    assert.equal(typeof browserAdapter.evaluateInMainWorld, 'function');
    const result = await browserAdapter.evaluateInMainWorld(page, pageFunction, arg);

    assert.equal(result, 'ok');
    assert.deepEqual(calls, [[pageFunction, arg, false]]);
  });

  it('uses unified Headless Chromium without overriding UA', async () => {
    const runtime = fakeBrowserRuntime();
    const launch = vi.spyOn(chromium, 'launch').mockResolvedValue(runtime.browser);

    const launched = await browserAdapter.launchBrowser();

    assert.deepEqual(launch.mock.calls, [[{ headless: true, channel: 'chromium' }]]);
    assert.equal(runtime.browser.newContext.mock.calls[0][0].userAgent, undefined);
    await browserAdapter.closeBrowser(launched.browser);
  });

  it('keeps headed mode on the regular bundled browser path', async () => {
    const runtime = fakeBrowserRuntime();
    const launch = vi.spyOn(chromium, 'launch').mockResolvedValue(runtime.browser);

    const launched = await browserAdapter.launchBrowser({ headed: true });

    assert.deepEqual(launch.mock.calls, [[{ headless: false }]]);
    await browserAdapter.closeBrowser(launched.browser);
  });
});
