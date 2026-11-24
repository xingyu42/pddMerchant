import { FixtureStore } from '../../adapter/fixtures/core.js';
import { createFixtureBrowserRuntime } from '../../adapter/fixtures/browser.js';
import { createFixtureMallPort } from '../../adapter/fixtures/mall.js';
import {
  createFixtureAuthPort,
  verifyFixtureMerchantContext,
  mockIsAuthValid,
  mockIsAuthIndeterminate,
  mockIsConsumerAuthValid,
  hasFixtureRelogin,
  createFixtureReloginContext,
} from '../../adapter/fixtures/auth.js';
import { createFixtureDaemonProcessPort } from '../../adapter/fixtures/daemon.js';
import { createFixtureEndpointTransport } from '../../adapter/fixtures/endpoint.js';
import { mockCurrentMall, mockListMalls, mockRunEndpoint, mockPasswordLogin } from '../../adapter/mock-dispatcher.js';
import {
  createFixtureCategoryResolver,
  createFixtureDraftSession,
  createFixtureObserveSourcePage,
  createFixtureOpenCategoryDraft,
  createNullSourceGoodsCache,
} from '../../adapter/fixtures/goods-publish.js';
import { createLiveMerchantDraftEditor } from '../../adapter/goods-publish/merchant-draft-editor.js';
import { FIXTURE_QR_IMAGE, openFixtureTakeover, createFixtureConsoleLoginDriver } from '../../adapter/console-login-fixture.js';
import { invalidTakeoverInput } from '../../adapter/takeover.js';
import { consoleRequestError } from '../../services/console-runtime.js';
import { createSourceProductFetcher } from '../../services/goods-publish/source-product-fetcher.js';
import {
  convergeDynamicProperties,
  fullCountDiscountPayloadValue,
} from '../../services/goods-publish/draft-planner.js';
import { prepareEditPayload, verifyDraftDetail } from '../../services/goods-publish/draft-guard.js';

function createFixtureHelpers({ fixtureStore, loadFixture, parsedEnv, mall, clock, seal }) {
  return Object.freeze({
    fixtureStore,
    loadFixture,
    mockCurrentMall: () => mockCurrentMall(fixtureStore),
    mockListMalls: () => mockListMalls(fixtureStore),
    mockIsAuthValid: () => mockIsAuthValid(parsedEnv),
    mockIsAuthIndeterminate: () => mockIsAuthIndeterminate(parsedEnv),
    mockIsConsumerAuthValid: () => mockIsConsumerAuthValid(parsedEnv),
    mockPasswordLogin: (task) => mockPasswordLogin(task, parsedEnv),
    verifyFixtureMerchantContext: (sessionOrContext, options = {}) => verifyFixtureMerchantContext(sessionOrContext, {
      getCurrentMall: () => mall.detectCurrentMall(),
      isInvalid: () => Boolean(parsedEnv?.authInvalid),
      isIndeterminate: () => Boolean(parsedEnv?.authIndeterminate),
      now: clock.now,
      ...options,
      seal: options.seal === undefined ? seal : options.seal,
    }),
    hasFixtureRelogin,
    createFixtureReloginContext,
    FIXTURE_QR_IMAGE,
    openFixtureTakeover,
  });
}

function createFixturePasswordLogin(parsedEnv) {
  return async function fixturePasswordLogin(page, _credential, task) {
    const result = await mockPasswordLogin(task, parsedEnv);
    if (result.outcome === 'success') {
      const context = typeof page?.context === 'function' ? page.context() : null;
      if (typeof context?.addCookies === 'function') {
        await context.addCookies([{ name: 'PDD_FIXTURE_RELOGIN', value: '1', domain: '.pinduoduo.com', path: '/' }]);
      }
      if (context && task?.expectedMallId != null) {
        context.fixtureMallId = task.expectedMallId;
      }
    }
    return result;
  };
}

function createFixtureCompleteRoute(consoleLoginDriver) {
  return Object.freeze({
    method: 'POST',
    template: '/api/sessions/:id/fixture-complete',
    pattern: /^\/api\/sessions\/([^/]+)\/fixture-complete$/,
    run: async ({ id, body, consoleApp, runtime }) => {
      const app = consoleApp ?? runtime?.consoleApp;
      const session = app?.sessions?.get(id);
      if (!session || !['takeover', 'sms', 'qr'].includes(session.state)) {
        throw consoleRequestError(409, 'E_CONSOLE_SESSION_STATE', '登录状态已变化');
      }
      if (!['success', 'timeout'].includes(body?.outcome)) throw invalidTakeoverInput();
      const driver = runtime?.ports?.consoleLoginDriver ?? consoleLoginDriver;
      if (typeof driver?.completeSession !== 'function') {
        throw consoleRequestError(409, 'E_CONSOLE_SESSION_STATE', '登录状态已变化');
      }
      driver.completeSession(id, body.outcome);
      await app.sessions.awaitDone(id);
      return { ok: true };
    },
  });
}

export function createFixtureBundle({ seal, clock, parsedEnv, env, overrides = {}, includeConsole = false } = {}) {
  const fixtureStore = overrides.fixtureStore ?? new FixtureStore({
    fixtureDir: parsedEnv?.fixtureDir,
    env: parsedEnv?.testEnv,
  });
  const browser = overrides.browser ?? createFixtureBrowserRuntime();
  const mall = overrides.mall ?? createFixtureMallPort({ fixtureStore });
  const auth = overrides.auth ?? createFixtureAuthPort({
    seal,
    authInvalid: () => Boolean(parsedEnv?.authInvalid),
    authIndeterminate: () => Boolean(parsedEnv?.authIndeterminate),
    consumerAuthInvalid: () => Boolean(parsedEnv?.consumerAuthInvalid),
    getCurrentMall: () => mall.detectCurrentMall(),
    now: clock.now,
  });
  const daemonProcess = overrides.daemonProcess ?? createFixtureDaemonProcessPort({ env });
  const endpointTransport = overrides.endpointTransport ?? createFixtureEndpointTransport({
    fixtureStore,
    readEndpoint: mockRunEndpoint,
  });
  const passwordLogin = overrides.passwordLogin ?? createFixturePasswordLogin(parsedEnv);
  const consoleLoginDriver = includeConsole
    ? (overrides.consoleLoginDriver ?? createFixtureConsoleLoginDriver({
        authPort: auth,
        seal,
        clock,
        parsedEnv,
      }))
    : null;
  const consoleExtraRoutes = includeConsole
    ? (overrides.consoleExtraRoutes ?? Object.freeze([createFixtureCompleteRoute(consoleLoginDriver)]))
    : Object.freeze([]);
  const loadFixture = (relPath) => fixtureStore.load(relPath);

  function createFixtureSourceFetcher({ parsedEnv: envConfig, browserPort, scrapeCooldown }) {
    const baseFetcher = createSourceProductFetcher({
      sourceCache: createNullSourceGoodsCache(),
      scrapeCooldown,
      sourceProxyEnv: envConfig.sourceProxyEnv,
      scrapeSimulate: false,
      browserPort,
      observePage: createFixtureObserveSourcePage({ fixtureStore }),
      resolveConsumerAccount: async () => ({ accountId: 'fixture-consumer' }),
      loadConsumerAuthState: () => ({ state: { cookies: [], origins: [] } }),
      deleteConsumerAuthState: async () => ({ removed: false, existed: false }),
      sleep: clock.sleep,
      now: clock.now,
    });
    return Object.freeze({
      async prepare(goodsUrl) {
        const acquisition = await baseFetcher.prepare(goodsUrl);
        return Object.freeze({
          ...acquisition,
          async fetch(fetchOpts = {}) {
            if (fetchOpts.browserSession) {
              return acquisition.fetch(fetchOpts);
            }
            return browserPort.withSession(
              { ownerTag: 'fixture-source-fetch' },
              (session) => acquisition.fetch({ ...fetchOpts, browserSession: session }),
            );
          },
        });
      },
    });
  }

  function createGoodsPublishPort({ parsedEnv: envConfig, browserPort, endpointPort, scrapeCooldown }) {
    const sourceFetcher = createFixtureSourceFetcher({
      parsedEnv: envConfig,
      browserPort,
      scrapeCooldown,
    });
    const categoryResolver = createFixtureCategoryResolver({ fixtureStore });
    const draftEditor = createLiveMerchantDraftEditor({
      endpoint: endpointPort,
      mode: 'fixture',
      clock,
      openCategoryDraft: createFixtureOpenCategoryDraft({ fixtureStore }),
      checkRisk: async () => {},
      convergeDynamic: convergeDynamicProperties,
      preparePayload: prepareEditPayload,
      verifyDetail: verifyDraftDetail,
      createDraftSession: ({ draft }) => createFixtureDraftSession({
        draft,
        fixtureStore,
        fullCountDiscountPayload: fullCountDiscountPayloadValue,
      }),
    });
    return Object.freeze({ sourceFetcher, categoryResolver, draftEditor });
  }

  return Object.freeze({
    mode: 'fixture',
    browser,
    mall,
    auth,
    daemonProcess,
    endpointTransport,
    passwordLogin,
    consoleLoginDriver,
    createGoodsPublishPort,
    consoleExtraRoutes,
    loadFixture,
    fixture: createFixtureHelpers({ fixtureStore, loadFixture, parsedEnv, mall, clock, seal }),
  });
}
