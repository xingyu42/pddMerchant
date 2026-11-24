import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import { createLiveBrowserRuntime } from '../../src/adapter/browser.js';
import { createFixtureBrowserRuntime } from '../../src/adapter/fixtures/browser.js';
import { createInMemoryBrowserRuntime } from '../helpers/in-memory-ports.js';
import { PddCliError } from '../../src/infra/errors.js';

function createFakeChromium({ version = '136.0.7103.92', onLaunch } = {}) {
  const launches = [];
  const browsers = [];
  let seq = 0;

  const chromium = {
    executablePath: () => '/synthetic/chromium',
    async launch(options) {
      launches.push(options);
      if (onLaunch) await onLaunch(options, launches.length);
      const contexts = [];
      let closed = false;
      const browser = {
        id: ++seq,
        contexts: () => contexts,
        version: vi.fn(async () => (typeof version === 'function' ? version(options) : version)),
        newContext: vi.fn(async (contextOptions) => {
          const pages = [];
          const context = {
            options: contextOptions,
            initScripts: [],
            pages,
            closed: false,
            addInitScript: vi.fn(async (fn) => {
              context.initScripts.push(fn);
            }),
            newPage: vi.fn(async () => {
              const page = {
                closed: false,
                context: () => context,
                close: vi.fn(async () => { page.closed = true; }),
                goto: vi.fn(async () => {}),
                url: () => 'about:blank',
              };
              pages.push(page);
              return page;
            }),
            storageState: vi.fn(async () => structuredClone(contextOptions.storageState ?? { cookies: [], origins: [] })),
            cookies: vi.fn(async () => structuredClone(contextOptions.storageState?.cookies ?? [])),
            close: vi.fn(async () => { context.closed = true; }),
          };
          contexts.push(context);
          return context;
        }),
        close: vi.fn(async () => { closed = true; }),
        get isClosed() { return closed; },
      };
      browsers.push(browser);
      return browser;
    },
  };

  return { chromium, launches, browsers };
}

const ADAPTER_FACTORIES = [
  {
    name: 'live',
    create: (opts = {}) => {
      const fake = createFakeChromium(opts.chromiumOpts);
      const runtime = createLiveBrowserRuntime({
        loadChromium: async () => fake.chromium,
        getExecutablePath: async () => (opts.available === false ? '' : '/synthetic/chromium'),
        exists: () => opts.available !== false,
        platform: opts.platform ?? 'linux',
        listProcesses: opts.listProcesses ?? (() => []),
        kill: opts.kill ?? (() => {}),
        dbPrefix: opts.dbPrefix ?? 'deadbeef',
        log: opts.log ?? { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
      });
      return { runtime, fake };
    },
  },
  {
    name: 'fixture',
    create: (opts = {}) => ({
      runtime: createFixtureBrowserRuntime({ available: opts.available ?? true }),
    }),
  },
  {
    name: 'in-memory',
    create: (opts = {}) => ({
      runtime: createInMemoryBrowserRuntime({
        available: opts.available ?? true,
        reclaimCount: opts.reclaimCount ?? 0,
      }),
    }),
  },
];

describe.each(ADAPTER_FACTORIES)('BrowserRuntimePort shared contract ($name)', ({ name, create }) => {
  it('checks browser availability with stable { ok, detail } shape', async () => {
    const okResult = await create({ available: true }).runtime.checkAvailability();
    assert.equal(okResult.ok, true);
    assert.equal(typeof okResult.detail, 'object');

    const failResult = await create({ available: false }).runtime.checkAvailability();
    assert.equal(failResult.ok, false);
    assert.equal(typeof failResult.detail, 'object');
  });

  it('returns an opaque BrowserSession without exposing raw browser internals', async () => {
    const { runtime } = create();
    const state = {
      cookies: [{ name: 'PASS_ID', value: 'synthetic' }],
      origins: [],
      merchant_auth: { secret: 'must-not-leak' },
    };
    const session = await runtime.openSession({ storageState: state });
    try {
      assert.equal(Object.hasOwn(session, 'browser'), false);
      assert.ok(session.page);
      assert.ok(session.context);
      assert.equal(typeof session.close, 'function');
      assert.equal(typeof session.createSnapshotContext, 'function');
    } finally {
      await session.close();
      await session.close();
    }
  });

  it.each(['', 'UPPER', 'a/b', 'a'.repeat(33), 42, null])('rejects invalid ownerTag %j with E_BROWSER_RUNTIME', async (ownerTag) => {
    const { runtime } = create();
    await assert.rejects(
      runtime.openSession({ ownerTag }),
      (error) => error instanceof PddCliError && error.code === 'E_BROWSER_RUNTIME' && error.detail?.reason === 'invalid_owner_tag',
    );
  });

  it('rejects malformed storageState on openSession, deriveConsumerContext and createSnapshotContext', async () => {
    const { runtime } = create();
    await assert.rejects(
      runtime.openSession({ storageState: { cookies: [] } }),
      (error) => error.code === 'E_BROWSER_RUNTIME' && error.detail?.reason === 'snapshot_shape_invalid',
    );
    const session = await runtime.openSession();
    try {
      await assert.rejects(
        runtime.deriveConsumerContext(session, { storageState: { origins: [] } }),
        (error) => error.code === 'E_BROWSER_RUNTIME' && error.detail?.reason === 'snapshot_shape_invalid',
      );
      await assert.rejects(
        session.createSnapshotContext({ cookies: [] }),
        (error) => error.code === 'E_BROWSER_RUNTIME' && error.detail?.reason === 'snapshot_shape_invalid',
      );
    } finally {
      await session.close();
    }
  });

  it('withSession closes the session on success and preserves business errors on failure', async () => {
    const { runtime } = create();
    const seen = [];
    const value = await runtime.withSession({ headed: false }, async (session) => {
      seen.push(session);
      return { ok: true };
    });
    assert.deepEqual(value, { ok: true });
    await assert.rejects(
      runtime.deriveConsumerContext(seen[0]),
      (error) => error.code === 'E_BROWSER_RUNTIME' && error.detail?.reason === 'browser_profile_missing',
    );

    const boom = new PddCliError({ code: 'E_BUSINESS', message: 'domain boom', exitCode: 6 });
    const errored = [];
    await assert.rejects(
      runtime.withSession({}, async (session) => {
        errored.push(session);
        throw boom;
      }),
      (err) => err === boom,
    );
    await assert.rejects(
      runtime.deriveConsumerContext(errored[0]),
      (error) => error.code === 'E_BROWSER_RUNTIME' && error.detail?.reason === 'browser_profile_missing',
    );
  });

  it('isolates active sessions and Runtime Browser Profiles per runtime instance', async () => {
    const runtimeA = create().runtime;
    const runtimeB = create().runtime;
    const sessionA = await runtimeA.openSession();
    const sessionB = await runtimeB.openSession();

    try {
      await assert.rejects(
        runtimeB.deriveConsumerContext(sessionA),
        (error) => error.code === 'E_BROWSER_RUNTIME' && error.detail?.reason === 'browser_profile_missing',
      );
      await assert.rejects(
        runtimeA.deriveConsumerContext({}),
        (error) => error.code === 'E_BROWSER_RUNTIME' && error.detail?.reason === 'browser_profile_missing',
      );

      const consumerA = await runtimeA.deriveConsumerContext(sessionA, {
        storageState: { cookies: [], origins: [] },
        proxy: { server: 'http://127.0.0.1:8888' },
      });
      assert.ok(consumerA.context);
      assert.ok(consumerA.page);
      assert.equal(typeof consumerA.close, 'function');
      await consumerA.close();

      await Promise.all([runtimeA.closeAll(), runtimeA.closeAll()]);
      await assert.rejects(
        runtimeA.deriveConsumerContext(sessionA),
        (error) => error.code === 'E_BROWSER_RUNTIME' && error.detail?.reason === 'browser_profile_missing',
      );
      const consumerB = await runtimeB.deriveConsumerContext(sessionB);
      await consumerB.close();
    } finally {
      await runtimeA.closeAll();
      await runtimeB.closeAll();
    }
  });

  it('reclaimOrphans returns a numeric count', async () => {
    const { runtime } = create({ reclaimCount: 0 });
    const reclaimed = await runtime.reclaimOrphans();
    assert.equal(Number.isInteger(reclaimed) && reclaimed >= 0, true, `${name} reclaimOrphans must return integer >= 0`);
  });
});

describe('Live BrowserRuntimePort ADR-0002 & ADR-0003 contracts', () => {
  it('enforces headless consistency profile, dynamic UA, init script order and consumer inheritance', async () => {
    const fake = createFakeChromium({ version: '136.0.7103.92' });
    const runtime = createLiveBrowserRuntime({
      loadChromium: async () => fake.chromium,
      platform: 'linux',
    });

    const session = await runtime.openSession({
      storageState: { cookies: [{ name: 'PASS_ID', value: 'x' }], origins: [], merchant_auth: { mallId: '900001' } },
      ownerTag: 'daemon-1',
    });
    try {
      assert.equal(fake.launches.length, 1);
      assert.deepEqual(fake.launches[0], {
        headless: true,
        channel: 'chrome',
        args: ['--enable-gpu', '--pdd-cli-daemon=daemon-1'],
      });
      const mainCtx = fake.browsers[0].contexts()[0];
      assert.deepEqual(mainCtx.options, {
        viewport: { width: 1902, height: 984 },
        screen: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
        storageState: { cookies: [{ name: 'PASS_ID', value: 'x' }], origins: [] },
      });
      assert.equal(mainCtx.addInitScript.mock.calls.length, 1);
      assert.equal(
        mainCtx.addInitScript.mock.invocationCallOrder[0] < mainCtx.newPage.mock.invocationCallOrder[0],
        true,
      );

      const consumer = await runtime.deriveConsumerContext(session, {
        storageState: { cookies: [], origins: [], merchant_auth: { secret: 'ignored' } },
        proxy: { server: 'http://synthetic-proxy:8080' },
      });
      const consumerCtx = fake.browsers[0].contexts()[1];
      assert.equal(consumerCtx.options.userAgent, mainCtx.options.userAgent);
      assert.deepEqual(consumerCtx.options.proxy, { server: 'http://synthetic-proxy:8080' });
      assert.deepEqual(consumerCtx.options.storageState, { cookies: [], origins: [] });
      assert.equal(mainCtx.options.proxy, undefined);
      assert.equal(consumerCtx.addInitScript.mock.calls.length, 1);
      await consumer.close();
    } finally {
      await runtime.closeAll();
    }
  });

  it('keeps headed contexts natural without GPU flag or consistency script', async () => {
    const fake = createFakeChromium({ version: '136.0.7103.92' });
    const runtime = createLiveBrowserRuntime({
      loadChromium: async () => fake.chromium,
      platform: 'win32',
    });

    const session = await runtime.openSession({ headed: true });
    try {
      assert.deepEqual(fake.launches[0], { headless: false, channel: 'chrome' });
      const ctx = fake.browsers[0].contexts()[0];
      assert.deepEqual(ctx.options, { viewport: null });
      assert.equal(ctx.addInitScript.mock.calls.length, 0);
      const consumer = await runtime.deriveConsumerContext(session);
      const consumerCtx = fake.browsers[0].contexts()[1];
      assert.deepEqual(consumerCtx.options, { viewport: null });
      assert.equal(consumerCtx.addInitScript.mock.calls.length, 0);
      await consumer.close();
    } finally {
      await runtime.closeAll();
    }
  });

  it('falls back to chromium only when system Chrome is explicitly missing and preserves non-missing errors', async () => {
    const warn = vi.fn();
    const fakeFallback = createFakeChromium({
      onLaunch: async (opts, callIndex) => {
        if (callIndex === 1 && opts.channel === 'chrome') {
          throw new Error("Chromium distribution 'chrome' is not found");
        }
      },
    });
    const fallbackRuntime = createLiveBrowserRuntime({
      loadChromium: async () => fakeFallback.chromium,
      log: { warn, debug: vi.fn(), info: vi.fn(), error: vi.fn() },
    });
    const session = await fallbackRuntime.openSession();
    await session.close();
    assert.deepEqual(fakeFallback.launches.map((entry) => entry.channel), ['chrome', 'chromium']);
    assert.equal(warn.mock.calls.length, 1);

    const permissionError = Object.assign(new Error('EACCES permission denied'), { code: 'EACCES' });
    const fakeError = createFakeChromium({
      onLaunch: async () => { throw permissionError; },
    });
    const strictRuntime = createLiveBrowserRuntime({
      loadChromium: async () => fakeError.chromium,
    });
    await assert.rejects(strictRuntime.openSession(), (err) => err === permissionError);
    assert.equal(fakeError.launches.length, 1);
  });

  it('cleans up partial resources when version or init fails', async () => {
    const fakeBadVersion = createFakeChromium({ version: 'invalid' });
    const badRuntime = createLiveBrowserRuntime({
      loadChromium: async () => fakeBadVersion.chromium,
    });
    await assert.rejects(
      badRuntime.openSession(),
      (err) => err.code === 'E_BROWSER_RUNTIME' && err.detail?.reason === 'invalid_browser_version',
    );
    assert.equal(fakeBadVersion.browsers[0].close.mock.calls.length, 1);
  });

  it('enforces ADR-0003 marked-browser-only reclaimOrphans in Live and no-ops in Fixture', async () => {
    const kill = vi.fn((pid) => { if (pid === 23) throw new Error('gone'); });
    const marker = '--pdd-cli-daemon=deadbeef-owner1';
    const liveRuntime = createLiveBrowserRuntime({
      dbPrefix: 'deadbeef',
      kill,
      listProcesses: () => [
        { pid: 21, imageName: 'chrome.exe', commandLine: `"C:\\Chrome\\chrome.exe" ${marker}` },
        { pid: process.pid, commandLine: `chrome ${marker}` },
        { pid: 23, commandLine: `chrome ${marker}` },
        { pid: 24, commandLine: 'chrome --pdd-cli-daemon=11111111-owner2' },
        { pid: 25, commandLine: `msedge ${marker}` },
        { pid: 26, imageName: 'powershell.exe', commandLine: `powershell -Command "chrome ${marker}"` },
      ],
    });
    assert.equal(await liveRuntime.reclaimOrphans(), 1);
    assert.deepEqual(kill.mock.calls, [[21], [23]]);

    const listProcesses = vi.fn();
    const fixtureRuntime = createFixtureBrowserRuntime();
    assert.equal(await fixtureRuntime.reclaimOrphans({ listProcesses }), 0);
    assert.equal(listProcesses.mock.calls.length, 0);
  });
});
