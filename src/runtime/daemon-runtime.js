import { resolveClock } from '../infra/clock.js';
import { createCandidateSeal } from '../infra/candidate-seal.js';
import { routesForMode } from '../daemon/routes.js';
import { createDaemonLogger, createDaemonLifecycleOps } from '../services/daemon-runtime.js';
import { parseRuntimeEnv } from './env.js';

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

  const bundle = parsedEnv.mode === 'fixture'
    ? (await import('./bundles/fixture-bundle.js')).createFixtureBundle({
      seal,
      clock,
      parsedEnv,
      rawEnv: env,
      overrides,
    })
    : (await import('./bundles/live-bundle.js')).createLiveBundle({
      seal,
      clock,
      rawEnv: env,
      overrides,
    });

  const ports = Object.freeze({
    browser: bundle.browser,
    mall: bundle.mall,
    auth: bundle.auth,
    daemonProcess: bundle.daemonProcess,
  });

  const { log, closeLog } = createDaemonLogger({ foreground, runtimeConfig });
  const lifecycle = createDaemonLifecycleOps({
    parsedEnv,
    browser: ports.browser,
    log,
    closeLog,
  });

  const routes = routesForMode(parsedEnv.mode);

  const closeAll = async () => {
    await Promise.allSettled([lifecycle.closeBrowsers()]);
    closeLog();
  };

  return Object.freeze({
    mode: parsedEnv.mode,
    foreground: Boolean(foreground),
    runtimeConfig: runtimeConfig ?? null,
    env: parsedEnv,
    rawEnv: env,
    ports,
    clock,
    seal,
    routes,
    fixture: bundle.fixture,
    loadFixture: bundle.loadFixture,
    ...lifecycle,
    closeAll,
  });
}
