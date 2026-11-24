import { FixtureStore } from '../../adapter/fixtures/core.js';
import { createFixtureBrowserRuntime } from '../../adapter/fixtures/browser.js';
import { createFixtureMallPort } from '../../adapter/fixtures/mall.js';
import {
  createFixtureAuthPort,
  mockIsAuthValid,
  mockIsAuthIndeterminate,
  mockIsConsumerAuthValid,
  hasFixtureRelogin,
  createFixtureReloginContext,
} from '../../adapter/fixtures/auth.js';
import { createFixtureDaemonProcessPort } from '../../adapter/fixtures/daemon.js';
import { createFixtureEndpointTransport } from '../../adapter/fixtures/endpoint.js';
import { mockCurrentMall, mockListMalls, mockRunEndpoint, mockPasswordLogin } from '../../adapter/mock-dispatcher.js';
import { FIXTURE_QR_IMAGE, openFixtureTakeover } from '../../adapter/console-login-fixture.js';

export function createFixtureBundle({ seal, clock, parsedEnv, rawEnv, overrides = {} } = {}) {
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
  const daemonProcess = overrides.daemonProcess ?? createFixtureDaemonProcessPort({ env: rawEnv });
  const endpointTransport = overrides.endpointTransport ?? createFixtureEndpointTransport({
    fixtureStore,
    readEndpoint: mockRunEndpoint,
  });
  const loadFixture = (relPath) => fixtureStore.load(relPath);

  return Object.freeze({
    mode: 'fixture',
    browser,
    mall,
    auth,
    daemonProcess,
    endpointTransport,
    loadFixture,
    fixture: Object.freeze({
      fixtureStore,
      loadFixture,
      mockCurrentMall: () => mockCurrentMall(fixtureStore),
      mockListMalls: () => mockListMalls(fixtureStore),
      mockIsAuthValid: () => mockIsAuthValid(parsedEnv),
      mockIsAuthIndeterminate: () => mockIsAuthIndeterminate(parsedEnv),
      mockIsConsumerAuthValid: () => mockIsConsumerAuthValid(parsedEnv),
      mockPasswordLogin: (task) => mockPasswordLogin(task, parsedEnv),
      hasFixtureRelogin,
      createFixtureReloginContext,
      FIXTURE_QR_IMAGE,
      openFixtureTakeover,
    }),
  });
}
