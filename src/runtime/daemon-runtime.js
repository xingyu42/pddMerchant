import { resolveClock } from '../infra/clock.js';
import { createCandidateSeal } from '../infra/candidate-seal.js';
import { registerCloseAllHook } from '../infra/runtime-cleanup.js';
import { routesForMode } from '../daemon/routes.js';
import { createDaemonLogger, createDaemonLifecycleOps } from '../services/daemon-runtime.js';
import { createConsoleApp } from '../services/console-login.js';
import { parseRuntimeEnv } from './env.js';

async function loadDaemonBundle({ parsedEnv, seal, clock, env, overrides }) {
  if (parsedEnv.mode === 'fixture') {
    const { createFixtureBundle } = await import('./bundles/fixture-bundle.js');
    return createFixtureBundle({ seal, clock, parsedEnv, env, overrides, includeConsole: true });
  }
  const { createLiveBundle } = await import('./bundles/live-bundle.js');
  return createLiveBundle({ seal, clock, env, overrides, includeConsole: true });
}

export async function composeDaemonRuntime({
  mode,
  foreground = true,
  runtimeConfig,
  env = process.env,
  overrides = {},
  clock: customClock,
} = {}) {
  const parsedEnv = parseRuntimeEnv(env, { mode });
  const clock = resolveClock(customClock);
  const seal = overrides.seal ?? createCandidateSeal();
  const resolvedRuntimeConfig = runtimeConfig ?? overrides.runtimeConfig ?? null;
  const bundle = await loadDaemonBundle({ parsedEnv, seal, clock, env, overrides });

  const ports = Object.freeze({
    browser: bundle.browser,
    mall: bundle.mall,
    auth: bundle.auth,
    daemonProcess: bundle.daemonProcess,
    consoleLoginDriver: bundle.consoleLoginDriver,
  });
  const consoleExtraRoutes = Object.freeze([...(bundle.consoleExtraRoutes ?? [])]);
  const consoleApp = overrides.consoleApp ?? createConsoleApp({
    driver: ports.consoleLoginDriver,
    seal,
    clock,
    runtimeConfig: resolvedRuntimeConfig,
  });

  const { log, closeLog } = createDaemonLogger({ foreground, runtimeConfig: resolvedRuntimeConfig ?? undefined });
  const lifecycle = createDaemonLifecycleOps({ parsedEnv, browser: ports.browser, log, closeLog });
  let unregisterCleanupHook = null;
  let closingPromise = null;
  const runCloseAll = async () => {
    await Promise.allSettled([consoleApp.sessions.closeAll(), lifecycle.closeBrowsers()]);
    closeLog();
  };
  const closeAll = () => {
    unregisterCleanupHook?.();
    unregisterCleanupHook = null;
    if (!closingPromise) closingPromise = runCloseAll();
    return closingPromise;
  };
  unregisterCleanupHook = registerCloseAllHook(closeAll);

  return Object.freeze({
    mode: parsedEnv.mode,
    foreground: Boolean(foreground),
    runtimeConfig: resolvedRuntimeConfig,
    env: parsedEnv,
    ports,
    clock,
    seal,
    consoleApp,
    consoleExtraRoutes,
    routes: routesForMode(parsedEnv.mode, consoleExtraRoutes),
    passwordLogin: bundle.passwordLogin,
    fixture: bundle.fixture,
    loadFixture: bundle.loadFixture,
    ...lifecycle,
    closeAll,
  });
}
