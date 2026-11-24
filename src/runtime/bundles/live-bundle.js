import { createLiveBrowserRuntime } from '../../adapter/browser.js';
import { createLiveMallPort } from '../../adapter/mall-port.js';
import { createLiveAuthPort } from '../../adapter/auth-port.js';
import { createLiveDaemonProcessPort } from '../../adapter/daemon-process.js';
import { createLiveEndpointTransport } from '../../adapter/endpoint-client.js';

export function createLiveBundle({ seal, clock, rawEnv, overrides = {} } = {}) {
  const browser = overrides.browser ?? createLiveBrowserRuntime();
  const mall = overrides.mall ?? createLiveMallPort();
  const auth = overrides.auth ?? createLiveAuthPort({ seal, now: clock.now });
  const daemonProcess = overrides.daemonProcess ?? createLiveDaemonProcessPort({ env: rawEnv });
  const endpointTransport = overrides.endpointTransport ?? createLiveEndpointTransport();

  return Object.freeze({
    mode: 'live',
    browser,
    mall,
    auth,
    daemonProcess,
    endpointTransport,
    loadFixture: null,
    fixture: null,
  });
}
