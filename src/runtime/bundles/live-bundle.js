import { createLiveBrowserRuntime } from '../../adapter/browser.js';
import { createLiveMallPort } from '../../adapter/mall-port.js';
import { createLiveAuthPort } from '../../adapter/auth-port.js';
import { createLiveDaemonProcessPort } from '../../adapter/daemon-process.js';
import { createLiveEndpointTransport } from '../../adapter/endpoint-client.js';
import { attemptPasswordLogin } from '../../adapter/password-login.js';
import { createLiveConsoleLoginDriver } from '../../adapter/console-login-driver.js';

export function createLiveBundle({ seal, clock, env, overrides = {}, includeConsole = false } = {}) {
  const browser = overrides.browser ?? createLiveBrowserRuntime();
  const mall = overrides.mall ?? createLiveMallPort();
  const auth = overrides.auth ?? createLiveAuthPort({ seal, now: clock.now });
  const daemonProcess = overrides.daemonProcess ?? createLiveDaemonProcessPort({ env });
  const endpointTransport = overrides.endpointTransport ?? createLiveEndpointTransport();
  const passwordLogin = overrides.passwordLogin ?? attemptPasswordLogin;
  const consoleLoginDriver = includeConsole
    ? (overrides.consoleLoginDriver ?? createLiveConsoleLoginDriver({
        browserRuntime: browser,
        authPort: auth,
        seal,
        clock,
      }))
    : null;

  return Object.freeze({
    mode: 'live',
    browser,
    mall,
    auth,
    daemonProcess,
    endpointTransport,
    passwordLogin,
    consoleLoginDriver,
    consoleExtraRoutes: Object.freeze([]),
    loadFixture: null,
    fixture: null,
  });
}
