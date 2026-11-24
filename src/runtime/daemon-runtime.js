import { resolveClock } from '../infra/clock.js';
import { createCandidateSeal } from '../infra/candidate-seal.js';
import { routesForMode } from '../daemon/routes.js';
import { createDaemonLogger, createDaemonLifecycleOps } from '../services/daemon-runtime.js';
import { parseRuntimeEnv } from './env.js';

async function loadDaemonBundle({ parsedEnv, seal, clock, env, overrides }) {
  if (parsedEnv.mode === 'fixture') {
    const { createFixtureBundle } = await import('./bundles/fixture-bundle.js');
    return createFixtureBundle({ seal, clock, parsedEnv, env, overrides });
  }
  const { createLiveBundle } = await import('./bundles/live-bundle.js');
  return createLiveBundle({ seal, clock, env, overrides });
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
  });

  const { log, closeLog } = createDaemonLogger({ foreground, runtimeConfig: resolvedRuntimeConfig ?? undefined });
  const lifecycle = createDaemonLifecycleOps({ parsedEnv, browser: ports.browser, log, closeLog });
  const closeAll = async () => {
    await Promise.allSettled([lifecycle.closeBrowsers()]);
    closeLog();
  };

  return Object.freeze({
    mode: parsedEnv.mode,
    foreground: Boolean(foreground),
    runtimeConfig: resolvedRuntimeConfig,
    env: parsedEnv,
    ports,
    clock,
    seal,
    routes: routesForMode(parsedEnv.mode),
    passwordLogin: bundle.passwordLogin,
    fixture: bundle.fixture,
    loadFixture: bundle.loadFixture,
    ...lifecycle,
    closeAll,
  });
}
