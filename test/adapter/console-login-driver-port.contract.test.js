import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { afterEach, describe, it, vi } from 'vitest';
import sharp from 'sharp';
import { createLiveConsoleLoginDriver } from '../../src/adapter/console-login-driver.js';
import { createFixtureConsoleLoginDriver } from '../../src/adapter/console-login-fixture.js';
import { createLiveBrowserRuntime } from '../../src/adapter/browser.js';
import { createLiveAuthPort } from '../../src/adapter/auth-port.js';
import { createFixtureAuthPort } from '../../src/adapter/fixtures/auth.js';
import { createCandidateSeal } from '../../src/infra/candidate-seal.js';
import { createInMemoryAuthPort, createInMemoryConsoleLoginDriver } from '../helpers/in-memory-ports.js';
import { mockMerchantProbeTransport } from '../helpers/merchant-probe-transport.js';

const EXPECTED_HANDLE_METHODS = [
  'attemptPassword',
  'captureQr',
  'close',
  'openTakeover',
  'submitSmsCode',
  'verify',
  'waitForAcquisition',
];

function createFakeCdp() {
  const cdp = new EventEmitter();
  cdp.send = vi.fn(async (method) => {
    if (method === 'Runtime.evaluate') {
      return { result: { value: { x: 10, y: 10, width: 200, height: 150, scrollX: 0, scrollY: 0 } } };
    }
    if (method === 'Page.captureScreenshot') return { data: 'fake-jpeg' };
    return {};
  });
  cdp.detach = vi.fn(async () => {});
  return cdp;
}

function createFakeBrowserEnv({
  version = '136.0.7103.92',
  failAt = null,
  events = [],
  cookiesOnCheck = [],
} = {}) {
  const launches = [];
  const contexts = [];
  const cdp = createFakeCdp();
  const originalSend = cdp.send.getMockImplementation();
  cdp.send = vi.fn(async (method, body) => {
    if (method === 'Page.stopScreencast') events.push('takeover_stop_screencast');
    return originalSend(method, body);
  });
  cdp.detach = vi.fn(async () => {
    events.push('takeover_closed');
  });

  const chromium = {
    executablePath: () => '/synthetic/chromium',
    async launch(options) {
      launches.push(options);
      if (failAt === 'launch') throw new Error('synthetic launch error');
      const browser = {
        version: async () => version,
        contexts: () => contexts,
        close: vi.fn(async () => {
          events.push('browser_closed');
        }),
        async newContext(contextOptions) {
          if (failAt === 'context') throw new Error('synthetic context error');
          const state = structuredClone(contextOptions.storageState ?? { cookies: [], origins: [] });
          const context = {
            options: contextOptions,
            initScripts: [],
            closed: false,
            addInitScript: vi.fn(async (fn) => {
              if (failAt === 'initScript') throw new Error('synthetic init script error');
              context.initScripts.push(fn);
            }),
            newPage: vi.fn(async () => {
              if (failAt === 'page') throw new Error('synthetic page error');
              const page = {
                context: () => context,
                close: vi.fn(async () => {
                  events.push('page_closed');
                }),
                goto: vi.fn(async () => {}),
                url: () => 'https://mms.pinduoduo.com/login/',
              };
              context.page = page;
              return page;
            }),
            newCDPSession: vi.fn(async () => cdp),
            storageState: vi.fn(async () => {
              const merged = state.cookies.some((c) => c.name === 'PASS_ID')
                ? state.cookies
                : [...state.cookies, ...cookiesOnCheck];
              return structuredClone({ ...state, cookies: merged });
            }),
            cookies: vi.fn(async () => {
              const merged = state.cookies.some((c) => c.name === 'PASS_ID')
                ? state.cookies
                : [...state.cookies, ...cookiesOnCheck];
              return structuredClone(merged);
            }),
            close: vi.fn(async () => {
              context.closed = true;
              events.push('context_closed');
            }),
          };
          contexts.push(context);
          return context;
        },
      };
      return browser;
    },
  };

  return { chromium, launches, contexts, cdp };
}

const handlesToClose = [];
afterEach(async () => {
  for (const handle of handlesToClose.splice(0)) {
    await handle.close();
  }
});

const ADAPTER_FACTORIES = [
  {
    name: 'live',
    create({
      seal = createCandidateSeal(),
      clock,
      events = [],
      onCaptureQr,
      mallId = '900001',
      mallName = 'Live Shop',
      login = true,
    } = {}) {
      mockMerchantProbeTransport(() => ({ mallId: Number(mallId), mallName, login }));
      const passCookie = { name: 'PASS_ID', value: 'pass-live', domain: '.pinduoduo.com', path: '/', secure: true };
      const env = createFakeBrowserEnv({
        events,
        cookiesOnCheck: [passCookie],
      });
      const browserRuntime = createLiveBrowserRuntime({
        loadChromium: async () => env.chromium,
        platform: 'linux',
      });
      const authPort = createLiveAuthPort({ seal, now: clock?.now });
      const wrappedAuthPort = {
        ...authPort,
        async verifyAndSeal(target, opts) {
          events.push('verify_called');
          return authPort.verifyAndSeal(target, opts);
        },
      };
      const driver = createLiveConsoleLoginDriver({
        browserRuntime,
        authPort: wrappedAuthPort,
        seal,
        clock,
        attemptPasswordLoginFn: async () => ({ outcome: 'challenge', challenge: 'slider' }),
        captureQrElementFn: async () => {
          events.push('qr_capture_start');
          const buf = onCaptureQr ? await onCaptureQr() : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVR4nGP4+vUrAAXCAuCuRnaIAAAAAElFTkSuQmCC', 'base64');
          events.push('qr_capture_end');
          return buf;
        },
        submitSmsCodeFn: async () => ({ outcome: 'submitted' }),
      });
      return { driver, seal, env };
    },
  },
  {
    name: 'fixture',
    create({
      seal = createCandidateSeal(),
      clock,
      events = [],
      onCaptureQr,
      mallId = '900001',
      mallName = 'Fixture Shop',
      login = true,
    } = {}) {
      const authPort = createFixtureAuthPort({
        seal,
        authInvalid: !login,
        getCurrentMall: async () => ({ id: mallId, name: mallName }),
        now: clock?.now,
      });
      const wrappedAuthPort = {
        ...authPort,
        async verifyAndSeal(target, opts) {
          events.push('verify_called');
          return authPort.verifyAndSeal(target, opts);
        },
      };
      const driver = createFixtureConsoleLoginDriver({
        authPort: wrappedAuthPort,
        seal,
        clock,
        parsedEnv: { passwordLogin: 'challenge:slider' },
        onCaptureQr: async () => {
          events.push('qr_capture_start');
          if (onCaptureQr) await onCaptureQr();
          events.push('qr_capture_end');
        },
        onTakeoverClose: () => events.push('takeover_closed'),
        onPageClose: () => events.push('page_closed'),
      });
      return { driver, seal };
    },
  },
  {
    name: 'in-memory',
    create({
      seal = createCandidateSeal(),
      clock,
      events = [],
      onCaptureQr,
      mallId = '900001',
      mallName = 'Memory Shop',
      login = true,
    } = {}) {
      const authPort = createInMemoryAuthPort({
        seal,
        merchantVerdict: login ? 'verified' : 'rejected',
        merchantIdentity: { mallId, displayName: mallName },
        now: clock?.now,
      });
      const wrappedAuthPort = {
        ...authPort,
        async verifyAndSeal(target, opts) {
          events.push('verify_called');
          return authPort.verifyAndSeal(target, opts);
        },
      };
      const driver = createInMemoryConsoleLoginDriver({
        authPort: wrappedAuthPort,
        seal,
        clock,
        passwordOutcome: { outcome: 'challenge', challenge: 'slider' },
        onCaptureQr: async () => {
          events.push('qr_capture_start');
          const res = onCaptureQr ? await onCaptureQr() : undefined;
          events.push('qr_capture_end');
          return res;
        },
        onTakeoverClose: () => events.push('takeover_closed'),
        onPageClose: () => events.push('page_closed'),
      });
      return { driver, seal };
    },
  },
];

describe.each(ADAPTER_FACTORIES)('ConsoleLoginDriverPort shared contract ($name)', ({ name, create }) => {
  it('returns an opaque DriverSessionHandle without leaking raw browser/page/takeover handles', async () => {
    const { driver } = create();
    const controller = new AbortController();
    const handle = await driver.openSession({
      sessionId: 'sess-opaque-1',
      mode: 'password',
      ownerTag: 'daemon-1',
      deviceState: { cookies: [], origins: [] },
      signal: controller.signal,
      deadlineAt: Date.now() + 60_000,
    });
    handlesToClose.push(handle);

    assert.deepEqual(Object.keys(handle).sort(), EXPECTED_HANDLE_METHODS);
    for (const forbidden of ['browser', 'context', 'page', 'takeover', 'cdp']) {
      assert.equal(Object.hasOwn(handle, forbidden), false);
    }

    await handle.close();
    await handle.close();
  });

  it('validates openSession parameters and rejects already-aborted signals', async () => {
    const { driver } = create();
    const active = new AbortController();

    await assert.rejects(
      driver.openSession({
        sessionId: '',
        mode: 'password',
        ownerTag: 'daemon-1',
        deviceState: { cookies: [], origins: [] },
        signal: active.signal,
        deadlineAt: Date.now() + 60_000,
      }),
      { code: 'E_USAGE' },
    );
    await assert.rejects(
      driver.openSession({
        sessionId: 'sess-bad-mode',
        mode: 'unknown',
        ownerTag: 'daemon-1',
        deviceState: { cookies: [], origins: [] },
        signal: active.signal,
        deadlineAt: Date.now() + 60_000,
      }),
      { code: 'E_USAGE' },
    );
    await assert.rejects(
      driver.openSession({
        sessionId: 'sess-bad-owner',
        mode: 'password',
        ownerTag: 'INVALID_OWNER',
        deviceState: { cookies: [], origins: [] },
        signal: active.signal,
        deadlineAt: Date.now() + 60_000,
      }),
      { code: 'E_BROWSER_RUNTIME' },
    );
    await assert.rejects(
      driver.openSession({
        sessionId: 'sess-bad-state',
        mode: 'password',
        ownerTag: 'daemon-1',
        deviceState: { cookies: [] },
        signal: active.signal,
        deadlineAt: Date.now() + 60_000,
      }),
      { code: 'E_BROWSER_RUNTIME' },
    );

    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(
      driver.openSession({
        sessionId: 'sess-aborted',
        mode: 'password',
        ownerTag: 'daemon-1',
        deviceState: { cookies: [], origins: [] },
        signal: aborted.signal,
        deadlineAt: Date.now() + 60_000,
      }),
      { code: 'E_AUTH_CANCELLED' },
    );
  });

  it('shares takeover pointer/text/key/sms validation rules across all adapters', async () => {
    const { driver } = create();
    const controller = new AbortController();
    const handle = await driver.openSession({
      sessionId: 'sess-takeover-1',
      mode: 'password',
      ownerTag: 'daemon-1',
      deviceState: { cookies: [], origins: [] },
      signal: controller.signal,
      deadlineAt: Date.now() + 60_000,
    });
    handlesToClose.push(handle);

    const takeover = await handle.openTakeover();
    assert.equal(Object.hasOwn(takeover, 'cdp'), false);
    assert.equal(typeof takeover.frames[Symbol.asyncIterator], 'function');

    await assert.rejects(
      async () => takeover.dispatchPointer([{ t: 0, type: 'down', x: 0, y: 0 }], { seq: 0 }),
      { code: 'E_USAGE' },
    );
    await assert.rejects(
      async () => takeover.dispatchPointer([{ t: 0, type: 'down', x: 2, y: 0 }], { gesture_id: 'g1', seq: 0 }),
      { code: 'E_USAGE' },
    );
    await assert.rejects(async () => takeover.insertText('x'.repeat(65)), { code: 'E_USAGE' });
    await assert.rejects(async () => takeover.pressKey('Escape'), { code: 'E_USAGE' });
    await assert.rejects(handle.submitSmsCode('12ab'), { code: 'E_USAGE' });

    if (name !== 'live') {
      const down = await takeover.dispatchPointer([{ t: 0, type: 'down', x: 0.2, y: 0.2 }], { gesture_id: 'drag', seq: 0 });
      assert.deepEqual(down, { editable: null, numeric: null });
      const duplicate = await takeover.dispatchPointer([{ t: 10, type: 'move', x: 0.4, y: 0.2 }], { gesture_id: 'drag', seq: 0 });
      assert.deepEqual(duplicate, { editable: null, numeric: null, result: 'interrupted' });
      const completed = await takeover.dispatchPointer(
        [{ t: 0, type: 'down', x: 0.1, y: 0.1 }, { t: 20, type: 'up', x: 0.8, y: 0.1 }],
        { gesture_id: 'drag-2', seq: 0 },
      );
      assert.deepEqual(completed, { editable: false, numeric: false });
      await takeover.insertText('123456');
      await takeover.pressKey('Enter');
    }
  });

  it('drains in-flight QR refresh, closes takeover & page, and only then runs AuthPort.verifyAndSeal', async () => {
    const events = [];
    let releaseQr;
    const qrGate = new Promise((resolve) => { releaseQr = resolve; });
    const seal = createCandidateSeal();
    const { driver } = create({
      seal,
      events,
      onCaptureQr: () => qrGate,
    });
    const controller = new AbortController();
    const handle = await driver.openSession({
      sessionId: 'sess-verify-order',
      mode: 'qr',
      ownerTag: 'daemon-1',
      deviceState: { cookies: [], origins: [] },
      signal: controller.signal,
      deadlineAt: Date.now() + 60_000,
    });
    handlesToClose.push(handle);

    await handle.openTakeover();
    const qrPending = handle.captureQr();
    await Promise.resolve();
    const verifyPending = handle.verify({ expectedMallId: '900001' });

    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(events, ['qr_capture_start']);

    releaseQr(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVR4nGP4+vUrAAXCAuCuRnaIAAAAAElFTkSuQmCC', 'base64'));
    const qrUrl = await qrPending;
    assert.match(qrUrl, /^data:image\/png;base64,/);

    const verified = await verifyPending;
    assert.equal(verified.verdict, 'verified');
    assert.equal(seal.has(verified.candidate), true);

    const endIdx = events.indexOf('qr_capture_end');
    const takeoverClosedIdx = events.indexOf('takeover_closed');
    const pageClosedIdx = events.indexOf('page_closed');
    const verifyIdx = events.indexOf('verify_called');

    assert.ok(endIdx >= 0);
    assert.ok(takeoverClosedIdx > endIdx, `expected takeover_closed after qr_capture_end: ${JSON.stringify(events)}`);
    assert.ok(pageClosedIdx > takeoverClosedIdx, `expected page_closed after takeover_closed: ${JSON.stringify(events)}`);
    assert.ok(verifyIdx > pageClosedIdx, `expected verify_called after page_closed: ${JSON.stringify(events)}`);
  });
});

describe('LiveConsoleLoginDriver targeted contracts', () => {
  it('rolls back partial initialization and browser session when post-open abort occurs', async () => {
    const events = [];
    const env = createFakeBrowserEnv({ events });
    const seal = createCandidateSeal();
    const controller = new AbortController();
    const baseRuntime = createLiveBrowserRuntime({ loadChromium: async () => env.chromium, platform: 'linux' });
    const wrappedRuntime = {
      ...baseRuntime,
      async openSession(options) {
        const session = await baseRuntime.openSession(options);
        controller.abort();
        return session;
      },
    };
    const authPort = createLiveAuthPort({ seal });
    const driver = createLiveConsoleLoginDriver({ browserRuntime: wrappedRuntime, authPort, seal });

    await assert.rejects(
      driver.openSession({
        sessionId: 'sess-partial-abort',
        mode: 'password',
        ownerTag: 'daemon-2',
        deviceState: { cookies: [], origins: [] },
        signal: controller.signal,
        deadlineAt: Date.now() + 60_000,
      }),
      { code: 'E_AUTH_CANCELLED' },
    );
    assert.ok(events.includes('context_closed'));
    assert.ok(events.includes('browser_closed'));
  });

  it('cleans up partial resources when browser context or page creation fails', async () => {
    for (const failAt of ['context', 'initScript', 'page']) {
      const events = [];
      const env = createFakeBrowserEnv({ failAt, events });
      const seal = createCandidateSeal();
      const browserRuntime = createLiveBrowserRuntime({ loadChromium: async () => env.chromium, platform: 'linux' });
      const authPort = createLiveAuthPort({ seal });
      const driver = createLiveConsoleLoginDriver({ browserRuntime, authPort, seal });
      const controller = new AbortController();

      await assert.rejects(
        driver.openSession({
          sessionId: `sess-fail-${failAt}`,
          mode: 'password',
          ownerTag: 'daemon-3',
          deviceState: { cookies: [], origins: [] },
          signal: controller.signal,
          deadlineAt: Date.now() + 60_000,
        }),
        new RegExp(`synthetic ${failAt === 'initScript' ? 'init script' : failAt} error`),
      );
      assert.ok(events.includes('browser_closed'), `${failAt} must close browser`);
    }
  });

  it('inherits Runtime Browser Profile on both login context and verification snapshot context', async () => {
    mockMerchantProbeTransport(() => ({ mallId: 900001, mallName: 'Profile Shop', login: true }));
    const passCookie = { name: 'PASS_ID', value: 'pass-profile', domain: '.pinduoduo.com', path: '/', secure: true };
    const env = createFakeBrowserEnv({ cookiesOnCheck: [passCookie] });
    const seal = createCandidateSeal();
    const browserRuntime = createLiveBrowserRuntime({ loadChromium: async () => env.chromium, platform: 'linux' });
    const authPort = createLiveAuthPort({ seal });
    const driver = createLiveConsoleLoginDriver({ browserRuntime, authPort, seal });
    const controller = new AbortController();

    const handle = await driver.openSession({
      sessionId: 'sess-profile',
      mode: 'qr',
      ownerTag: 'daemon-4',
      deviceState: {
        cookies: [{ name: 'device_id', value: 'dev-1', domain: '.pinduoduo.com', path: '/' }],
        origins: [],
      },
      signal: controller.signal,
      deadlineAt: Date.now() + 60_000,
    });
    handlesToClose.push(handle);

    const verified = await handle.verify({ expectedMallId: '900001' });
    assert.equal(verified.verdict, 'verified');
    assert.equal(env.launches.length, 1);
    assert.deepEqual(env.launches[0], {
      headless: true,
      channel: 'chrome',
      args: ['--enable-gpu', '--pdd-cli-daemon=daemon-4'],
    });
    assert.equal(env.contexts.length, 2);
    assert.equal(env.contexts[0].options.userAgent, env.contexts[1].options.userAgent);
    assert.deepEqual(env.contexts[0].options.viewport, env.contexts[1].options.viewport);
    assert.equal(env.contexts[0].initScripts.length, 1);
    assert.equal(env.contexts[1].initScripts.length, 1);
    assert.equal(env.contexts[1].closed, true);
  });

  it('polls cookies at 200ms in waitForAcquisition and returns success or timeout without closing on timeout', async () => {
    let nowMs = 1_000_000;
    const sleepCalls = [];
    const clock = {
      now: () => nowMs,
      sleep: async (ms) => {
        sleepCalls.push(ms);
        nowMs += ms;
      },
    };
    const cookies = [];
    const env = createFakeBrowserEnv({ cookiesOnCheck: cookies });
    const seal = createCandidateSeal();
    const browserRuntime = createLiveBrowserRuntime({ loadChromium: async () => env.chromium, platform: 'linux' });
    const authPort = createLiveAuthPort({ seal, now: clock.now });
    const driver = createLiveConsoleLoginDriver({ browserRuntime, authPort, seal, clock });
    const controller = new AbortController();

    const handle = await driver.openSession({
      sessionId: 'sess-poll',
      mode: 'qr',
      ownerTag: 'daemon-5',
      deviceState: { cookies: [], origins: [] },
      signal: controller.signal,
      deadlineAt: nowMs + 720_000,
    });
    handlesToClose.push(handle);

    assert.equal(await handle.waitForAcquisition({ signal: controller.signal, expiresAt: nowMs + 450 }), 'timeout');
    assert.deepEqual(sleepCalls, [200, 200, 50]);

    cookies.push({ name: 'PASS_ID', value: 'pass-late', domain: '.pinduoduo.com', path: '/', secure: true });
    assert.equal(await handle.waitForAcquisition({ signal: controller.signal, expiresAt: nowMs + 1000 }), 'success');
  });

  it('validates fixture decoded 1x1 QR image via FixtureConsoleLoginDriver', async () => {
    const seal = createCandidateSeal();
    const authPort = createFixtureAuthPort({ seal });
    const driver = createFixtureConsoleLoginDriver({ authPort, seal });
    const controller = new AbortController();
    const handle = await driver.openSession({
      sessionId: 'sess-qr-decode',
      mode: 'qr',
      ownerTag: 'daemon-6',
      deviceState: { cookies: [], origins: [] },
      signal: controller.signal,
      deadlineAt: Date.now() + 60_000,
    });
    handlesToClose.push(handle);

    const qr = await handle.captureQr();
    const decoded = await sharp(Buffer.from(qr.split(',')[1], 'base64')).raw().toBuffer({ resolveWithObject: true });
    assert.equal(decoded.info.width, 1);
    assert.equal(decoded.info.height, 1);
  });

  it('caps attemptPassword at 70s and submitSmsCode at 15s in LiveConsoleLoginDriver', async () => {
    let nowMs = 5_000_000;
    const clock = { now: () => nowMs, sleep: async () => {} };
    const env = createFakeBrowserEnv();
    const seal = createCandidateSeal();
    const browserRuntime = createLiveBrowserRuntime({ loadChromium: async () => env.chromium, platform: 'linux' });
    const authPort = createLiveAuthPort({ seal, now: clock.now });
    const seen = [];
    const driver = createLiveConsoleLoginDriver({
      browserRuntime,
      authPort,
      seal,
      clock,
      attemptPasswordLoginFn: async (_page, cred, task) => {
        seen.push({ kind: 'pw', cred, deadlineAt: task.deadlineAt });
        return { outcome: 'challenge', challenge: 'sms' };
      },
      submitSmsCodeFn: async (_page, code, task) => {
        seen.push({ kind: 'sms', code, deadlineAt: task.deadlineAt });
        return { outcome: 'submitted' };
      },
    });
    const controller = new AbortController();
    const handle = await driver.openSession({
      sessionId: 'sess-deadlines',
      mode: 'password',
      ownerTag: 'daemon-7',
      deviceState: { cookies: [], origins: [] },
      signal: controller.signal,
      deadlineAt: nowMs + 720_000,
    });
    handlesToClose.push(handle);

    const pwRes = await handle.attemptPassword({ loginName: 'u', password: 'p' });
    assert.deepEqual(pwRes, { outcome: 'challenge', challenge: 'sms' });
    const smsRes = await handle.submitSmsCode('123456');
    assert.deepEqual(smsRes, { outcome: 'submitted' });
    assert.equal(seen[0].deadlineAt, nowMs + 70_000);
    assert.equal(seen[1].deadlineAt, nowMs + 15_000);
  });

  it('drives FixtureConsoleLoginDriver waitForAcquisition via per-session completion latch', async () => {
    const seal = createCandidateSeal();
    const authPort = createFixtureAuthPort({ seal });
    const driver = createFixtureConsoleLoginDriver({ authPort, seal });
    const controller = new AbortController();
    const handle = await driver.openSession({
      sessionId: 'sess-latch',
      mode: 'password',
      ownerTag: 'daemon-8',
      deviceState: { cookies: [], origins: [] },
      signal: controller.signal,
      deadlineAt: Date.now() + 60_000,
    });
    handlesToClose.push(handle);

    const waiting = handle.waitForAcquisition({ signal: controller.signal, expiresAt: Date.now() + 60_000 });
    driver.completeSession('sess-latch', 'success');
    assert.equal(await waiting, 'success');
    assert.throws(() => driver.completeSession('sess-latch', 'success'), { code: 'E_CONSOLE_SESSION_STATE', httpStatus: 409 });
  });

  it('replays takeover gestures deterministically using the injected clock across shared rules', async () => {
    let nowMs = 2_000_000;
    const sleeps = [];
    const clock = {
      now: () => nowMs,
      sleep: async (ms) => {
        sleeps.push(ms);
        nowMs += ms;
      },
    };
    const seal = createCandidateSeal();
    const driver = createInMemoryConsoleLoginDriver({ seal, clock });
    const controller = new AbortController();
    const handle = await driver.openSession({
      sessionId: 'sess-gesture-clock',
      mode: 'password',
      ownerTag: 'daemon-9',
      deviceState: { cookies: [], origins: [] },
      signal: controller.signal,
      deadlineAt: nowMs + 60_000,
    });
    handlesToClose.push(handle);

    const takeover = await handle.openTakeover();
    const result = await takeover.dispatchPointer(
      [{ t: 0, type: 'down', x: 0.1, y: 0.2 }, { t: 45, type: 'up', x: 0.6, y: 0.2 }],
      { gesture_id: 'g-clock', seq: 0 },
    );
    assert.deepEqual(result, { editable: false, numeric: false });
    assert.deepEqual(sleeps, [45]);

    nowMs += 1500; // Exceed POINTER_LAG_MS (1000ms) for a stale seq=1 batch
    const stale = await takeover.dispatchPointer(
      [{ t: 0, type: 'down', x: 0.1, y: 0.2 }, { t: 10, type: 'move', x: 0.3, y: 0.2 }],
      { gesture_id: 'g-lag', seq: 0 },
    );
    assert.deepEqual(stale, { editable: null, numeric: null });
    nowMs += 1200;
    const lagged = await takeover.dispatchPointer(
      [{ t: 50, type: 'up', x: 0.5, y: 0.2 }],
      { gesture_id: 'g-lag', seq: 1 },
    );
    assert.deepEqual(lagged, { editable: null, numeric: null, result: 'interrupted' });
  });
});
