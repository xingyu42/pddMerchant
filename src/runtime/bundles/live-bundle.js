import { createLiveBrowserRuntime } from '../../adapter/browser.js';
import { createLiveMallPort } from '../../adapter/mall-port.js';
import { createLiveAuthPort } from '../../adapter/auth-port.js';
import { createLiveDaemonProcessPort } from '../../adapter/daemon-process.js';
import { createLiveEndpointTransport } from '../../adapter/endpoint-client.js';
import { attemptPasswordLogin } from '../../adapter/password-login.js';
import { createLiveInteractiveLogin } from '../../adapter/interactive-login.js';
import { createLiveConsoleLoginDriver } from '../../adapter/console-login-driver.js';
import { createCategoryResolver } from '../../adapter/goods-publish/category-resolver.js';
import { createLiveMerchantDraftEditor } from '../../adapter/goods-publish/merchant-draft-editor.js';
import { createSourceProductFetcher } from '../../services/goods-publish/source-product-fetcher.js';
import { convergeDynamicProperties } from '../../services/goods-publish/draft-planner.js';
import { prepareEditPayload, verifyDraftDetail } from '../../services/goods-publish/draft-guard.js';

export function createLiveBundle({ seal, clock, env, overrides = {}, includeConsole = false } = {}) {
  const browser = overrides.browser ?? createLiveBrowserRuntime();
  const mall = overrides.mall ?? createLiveMallPort();
  const auth = overrides.auth ?? createLiveAuthPort({ seal, now: clock.now });
  const { PDD_TEST_ADAPTER: _ignoredAdapter, ...daemonEnv } = env ?? process.env;
  const daemonProcess = overrides.daemonProcess ?? createLiveDaemonProcessPort({ env: daemonEnv });
  const endpointTransport = overrides.endpointTransport ?? createLiveEndpointTransport();
  const passwordLogin = overrides.passwordLogin ?? attemptPasswordLogin;
  const interactiveLogin = overrides.interactiveLogin ?? createLiveInteractiveLogin({
    browserPort: browser,
    authPort: auth,
    seal,
    clock,
  });
  const consoleLoginDriver = includeConsole
    ? (overrides.consoleLoginDriver ?? createLiveConsoleLoginDriver({
        browserRuntime: browser,
        authPort: auth,
        seal,
        clock,
      }))
    : null;

  function createGoodsPublishPort({ parsedEnv, runtimeConfig, browserPort, endpointPort, scrapeCooldown }) {
    const sourceFetcher = createSourceProductFetcher({
      scrapeCooldown,
      sourceProxyEnv: parsedEnv.sourceProxyEnv,
      scrapeSimulate: parsedEnv.scrapeSimulate,
      browserPort,
      sleep: clock.sleep,
      now: clock.now,
    });
    const categoryResolver = createCategoryResolver({
      apiBase: runtimeConfig?.categoryApiBase,
      sleep: clock.sleep,
      now: clock.now,
    });
    const draftEditor = createLiveMerchantDraftEditor({
      endpoint: endpointPort,
      writeRateTokensPerMinute: runtimeConfig?.writeRateTokensPerMinute ?? 20,
      mode: parsedEnv.mode,
      clock,
      convergeDynamic: convergeDynamicProperties,
      preparePayload: prepareEditPayload,
      verifyDetail: verifyDraftDetail,
    });
    return Object.freeze({ sourceFetcher, categoryResolver, draftEditor });
  }

  return Object.freeze({
    mode: 'live',
    browser,
    mall,
    auth,
    daemonProcess,
    endpointTransport,
    passwordLogin,
    interactiveLogin,
    consoleLoginDriver,
    createGoodsPublishPort,
    consoleExtraRoutes: Object.freeze([]),
    loadFixture: null,
    fixture: null,
  });
}
