import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { chromium } from 'patchright';
import * as browserAdapter from '../../src/adapter/browser.js';

function fakeBrowserRuntime({ version = '136.0.7103.114', addInitScriptError, newPageError } = {}) {
  const events = [];
  const page = { close: vi.fn(async () => {}) };
  const context = {
    addInitScript: vi.fn(async () => {
      events.push('addInitScript');
      if (addInitScriptError) throw addInitScriptError;
    }),
    newPage: vi.fn(async () => {
      events.push('newPage');
      if (newPageError) throw newPageError;
      return page;
    }),
    close: vi.fn(async () => {}),
  };
  const contexts = [];
  const browser = {
    version: vi.fn(async () => version),
    newContext: vi.fn(async () => {
      contexts.push(context);
      return context;
    }),
    contexts: vi.fn(() => contexts),
    close: vi.fn(async () => {}),
  };
  return { browser, context, page, events };
}

afterEach(async () => {
  await browserAdapter.closeAllBrowsers();
  vi.restoreAllMocks();
});

describe('browser runtime adapter contract', () => {
  it('owns the browser executable path lookup for doctor', () => {
    const executablePath = browserAdapter.getBrowserExecutablePath();
    assert.equal(typeof executablePath, 'string');
    assert.ok(executablePath.length > 0);
  });

  it('preserves Patchright main-world evaluate semantics', async () => {
    const calls = [];
    const page = { evaluate: async (...args) => { calls.push(args); return 'ok'; } };
    const pageFunction = ({ value }) => value;
    const arg = { value: 42 };

    const result = await browserAdapter.evaluateInMainWorld(page, pageFunction, arg);

    assert.equal(result, 'ok');
    assert.deepEqual(calls, [[pageFunction, arg, false]]);
  });

  it('builds Chrome UA from the actual major version for supported platforms', () => {
    const version = 'Chrome/136.0.7103.114';
    assert.match(browserAdapter.buildChromeUserAgent(version, 'linux'), /\(X11; Linux x86_64\).*Chrome\/136\.0\.0\.0/);
    assert.match(browserAdapter.buildChromeUserAgent(version, 'win32'), /\(Windows NT 10\.0; Win64; x64\).*Chrome\/136\.0\.0\.0/);
    assert.match(browserAdapter.buildChromeUserAgent(version, 'darwin'), /\(Macintosh; Intel Mac OS X 10_15_7\).*Chrome\/136\.0\.0\.0/);
  });

  it('rejects invalid browser versions and unsupported platforms', () => {
    assert.throws(
      () => browserAdapter.buildChromeUserAgent('not-a-version', 'linux'),
      (err) => err?.code === 'E_BROWSER_RUNTIME' && err?.detail?.reason === 'invalid_browser_version',
    );
    assert.throws(
      () => browserAdapter.buildChromeUserAgent('136.0.0.0', 'freebsd'),
      (err) => err?.code === 'E_BROWSER_RUNTIME' && err?.detail?.reason === 'unsupported_browser_platform',
    );
  });

  it('recognizes only explicit Chrome executable-missing errors', () => {
    assert.equal(browserAdapter.isChromeChannelMissingError(
      new Error("Chromium distribution 'chrome' is not found at /opt/google/chrome"),
    ), true);
    assert.equal(browserAdapter.isChromeChannelMissingError(
      new Error("browserType.launch: Executable doesn't exist at /opt/google/chrome"),
    ), true);
    assert.equal(browserAdapter.isChromeChannelMissingError(new Error('spawn EACCES')), false);
    assert.equal(browserAdapter.isChromeChannelMissingError(new Error('Browser process crashed')), false);
  });

  it('prefers system Chrome and creates the fixed Headless profile before the first page', async () => {
    const runtime = fakeBrowserRuntime();
    const launch = vi.spyOn(chromium, 'launch').mockResolvedValue(runtime.browser);

    const launched = await browserAdapter.launchBrowser();

    assert.deepEqual(launch.mock.calls, [[{
      headless: true,
      channel: 'chrome',
      args: ['--enable-gpu'],
    }]]);
    assert.deepEqual(runtime.browser.newContext.mock.calls[0][0], {
      viewport: { width: 1902, height: 984 },
      screen: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      userAgent: browserAdapter.buildChromeUserAgent('136.0.7103.114'),
    });
    assert.deepEqual(runtime.events, ['addInitScript', 'newPage']);
    assert.strictEqual(runtime.context.addInitScript.mock.calls[0][0], browserAdapter.installHeadlessConsistencyProfile);
    await browserAdapter.closeBrowser(launched.browser);
  });

  it('falls back to bundled Chromium only when system Chrome is missing', async () => {
    const runtime = fakeBrowserRuntime();
    const launch = vi.spyOn(chromium, 'launch')
      .mockRejectedValueOnce(new Error("Chromium distribution 'chrome' is not found"))
      .mockResolvedValueOnce(runtime.browser);

    const launched = await browserAdapter.launchBrowser();

    assert.deepEqual(launch.mock.calls, [
      [{ headless: true, channel: 'chrome', args: ['--enable-gpu'] }],
      [{ headless: true, channel: 'chromium', args: ['--enable-gpu'] }],
    ]);
    await browserAdapter.closeBrowser(launched.browser);
  });

  it('uses the same strict Chrome-to-Chromium fallback for headed mode', async () => {
    const runtime = fakeBrowserRuntime();
    const launch = vi.spyOn(chromium, 'launch')
      .mockRejectedValueOnce(new Error("Chromium distribution 'chrome' is not found"))
      .mockResolvedValueOnce(runtime.browser);

    const launched = await browserAdapter.launchBrowser({ headed: true });

    assert.deepEqual(launch.mock.calls, [
      [{ headless: false, channel: 'chrome' }],
      [{ headless: false, channel: 'chromium' }],
    ]);
    assert.deepEqual(runtime.browser.newContext.mock.calls[0][0], { viewport: null });
    await browserAdapter.closeBrowser(launched.browser);
  });

  it('does not hide permissions, crashes, proxy, or other launch failures behind fallback', async () => {
    for (const message of ['spawn EACCES', 'Browser process crashed', 'ERR_PROXY_CONNECTION_FAILED']) {
      const originalError = new Error(message);
      const launch = vi.spyOn(chromium, 'launch').mockRejectedValueOnce(originalError);

      await assert.rejects(() => browserAdapter.launchBrowser(), (err) => err === originalError);
      assert.deepEqual(launch.mock.calls, [[{
        headless: true,
        channel: 'chrome',
        args: ['--enable-gpu'],
      }]]);
      launch.mockRestore();
    }
  });

  it('uses natural headed Context settings without consistency injection', async () => {
    const runtime = fakeBrowserRuntime();
    const launch = vi.spyOn(chromium, 'launch').mockResolvedValue(runtime.browser);

    const launched = await browserAdapter.launchBrowser({ headed: true });

    assert.deepEqual(launch.mock.calls, [[{ headless: false, channel: 'chrome' }]]);
    assert.deepEqual(runtime.browser.newContext.mock.calls[0][0], { viewport: null });
    assert.equal(runtime.context.addInitScript.mock.calls.length, 0);
    assert.deepEqual(runtime.events, ['newPage']);
    await browserAdapter.closeBrowser(launched.browser);
  });

  it('loads an existing merchant storageState without changing the fixed profile', async () => {
    const runtime = fakeBrowserRuntime();
    vi.spyOn(chromium, 'launch').mockResolvedValue(runtime.browser);

    const launched = await browserAdapter.launchBrowser({ storageStatePath: process.execPath });

    const options = runtime.browser.newContext.mock.calls[0][0];
    assert.equal(options.storageState, process.execPath);
    assert.deepEqual(options.viewport, { width: 1902, height: 984 });
    assert.deepEqual(options.screen, { width: 1920, height: 1080 });
    await browserAdapter.closeBrowser(launched.browser);
  });

  it('maps invalid runtime versions to E_BROWSER_RUNTIME and closes the browser', async () => {
    const runtime = fakeBrowserRuntime({ version: 'unknown' });
    vi.spyOn(chromium, 'launch').mockResolvedValue(runtime.browser);

    await assert.rejects(
      () => browserAdapter.launchBrowser(),
      (err) => err?.code === 'E_BROWSER_RUNTIME' && err?.detail?.reason === 'invalid_browser_version',
    );
    assert.equal(runtime.browser.newContext.mock.calls.length, 0);
    assert.equal(runtime.browser.close.mock.calls.length, 1);
  });

  it('maps browser.version failures to E_BROWSER_RUNTIME and closes the browser', async () => {
    const runtime = fakeBrowserRuntime();
    runtime.browser.version.mockRejectedValueOnce(new Error('version unavailable'));
    vi.spyOn(chromium, 'launch').mockResolvedValue(runtime.browser);

    await assert.rejects(
      () => browserAdapter.launchBrowser(),
      (err) => err?.code === 'E_BROWSER_RUNTIME' && err?.detail?.reason === 'browser_version_unavailable',
    );
    assert.equal(runtime.browser.newContext.mock.calls.length, 0);
    assert.equal(runtime.browser.close.mock.calls.length, 1);
  });

  it('cleans partial Context initialization and preserves the original error', async () => {
    const initError = new Error('init script failed');
    const runtime = fakeBrowserRuntime({ addInitScriptError: initError });
    vi.spyOn(chromium, 'launch').mockResolvedValue(runtime.browser);

    await assert.rejects(() => browserAdapter.launchBrowser(), (err) => err === initError);
    assert.ok(runtime.context.close.mock.calls.length >= 1);
    assert.equal(runtime.browser.close.mock.calls.length, 1);
  });

  it('clears the RuntimeProfile when the browser closes', async () => {
    const runtime = fakeBrowserRuntime();
    vi.spyOn(chromium, 'launch').mockResolvedValue(runtime.browser);
    const launched = await browserAdapter.launchBrowser();

    await browserAdapter.closeBrowser(launched.browser);

    await assert.rejects(
      () => browserAdapter.createConsumerContext(launched.browser),
      (err) => err?.code === 'E_BROWSER_RUNTIME' && err?.detail?.reason === 'browser_profile_missing',
    );
  });

  it('keeps the handwritten override whitelist limited to three getters', () => {
    assert.deepEqual(browserAdapter.HEADLESS_OVERRIDE_KEYS, ['outerWidth', 'outerHeight', 'availHeight']);
  });
});
