import { loadRuntimeConfig } from '../infra/config.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { resolveClock } from '../infra/clock.js';
import { createOutputSink } from '../infra/output-sink.js';
import { createCandidateSeal } from '../infra/candidate-seal.js';
import { SCRAPE_COOLDOWN_PATH } from '../infra/paths.js';
import { createScrapeCooldown } from '../infra/scrape-cooldown.js';
import { registerCloseAllHook } from '../infra/runtime-cleanup.js';
import { createCommandEndpointClient, createEndpointRuntimeState } from '../adapter/endpoint-client.js';
import { daemonIsRunning as defaultDaemonIsRunning } from '../services/daemon.js';
import { parseRuntimeEnv } from './env.js';

const DEFAULT_MAINTENANCE_ENDPOINT_CONFIG = Object.freeze({
  rateLimitQps: 1,
  rateLimitBurst: 2,
  cooldownThreshold: 3,
  cooldownMs: 60_000,
});

const DEFAULT_MAINTENANCE_SCRAPE_COOLDOWN_CONFIG = Object.freeze({
  scrapeSoftBlockThreshold: 2,
  scrapeSoftBlockCooldownMs: 7_200_000,
});

function createScopedBrowserPort(parentBrowser) {
  const scopedSessions = new Set();

  async function openSession(options = {}) {
    const session = await parentBrowser.openSession(options);
    scopedSessions.add(session);
    return session;
  }

  async function withSession(optionsOrFn, maybeFn) {
    const hasOptions = typeof optionsOrFn !== 'function';
    const options = hasOptions ? (optionsOrFn ?? {}) : {};
    const fn = hasOptions ? maybeFn : optionsOrFn;
    const session = await openSession(options);
    try {
      return await fn(session);
    } finally {
      scopedSessions.delete(session);
      await session.close().catch(() => {});
    }
  }

  async function closeAll() {
    const pending = [...scopedSessions];
    scopedSessions.clear();
    await Promise.allSettled(pending.map((session) => session.close()));
  }

  return Object.freeze({
    ...parentBrowser,
    openSession,
    withSession,
    closeAll,
  });
}

async function resolveCommandRuntimeConfig({ runtimeConfigPolicy, configOptions, env, overrides }) {
  if (runtimeConfigPolicy !== 'required' && runtimeConfigPolicy !== 'maintenance') {
    throw new PddCliError({
      code: 'E_CONFIG_INVALID',
      message: `不支持的 runtimeConfigPolicy: ${String(runtimeConfigPolicy)}`,
      exitCode: ExitCodes.GENERAL,
    });
  }

  if (runtimeConfigPolicy === 'maintenance') {
    return overrides.runtimeConfig ?? null;
  }

  const loaded = await loadRuntimeConfig({
    env,
    ...configOptions,
  });
  return overrides.runtimeConfig ? { ...loaded, ...overrides.runtimeConfig } : loaded;
}

async function loadCommandBundle({ parsedEnv, seal, clock, env, overrides }) {
  if (parsedEnv.mode === 'fixture') {
    const { createFixtureBundle } = await import('./bundles/fixture-bundle.js');
    return createFixtureBundle({ seal, clock, parsedEnv, env, overrides });
  }
  const { createLiveBundle } = await import('./bundles/live-bundle.js');
  return createLiveBundle({ seal, clock, env, overrides });
}

function createCommandEndpointPort({ runtimeConfig, transport, clock, overrides }) {
  const effectiveEndpointConfig = {
    ...DEFAULT_MAINTENANCE_ENDPOINT_CONFIG,
    ...(runtimeConfig ?? {}),
  };
  const endpointState = overrides.endpointState ?? createEndpointRuntimeState(effectiveEndpointConfig);
  const endpointPort = overrides.endpoint ?? createCommandEndpointClient({
    runtimeConfig: effectiveEndpointConfig,
    transport,
    endpointState,
    clock,
  });
  return { endpointState, endpointPort };
}

function createCommandScrapeCooldown({ parsedEnv, runtimeConfig, clock, overrides }) {
  if (overrides.scrapeCooldown) return overrides.scrapeCooldown;
  const statePath = overrides.scrapeCooldownStatePath !== undefined
    ? overrides.scrapeCooldownStatePath
    : (parsedEnv.mode === 'fixture' ? null : SCRAPE_COOLDOWN_PATH);
  return createScrapeCooldown({
    now: clock.now,
    statePath,
    threshold: runtimeConfig?.scrapeSoftBlockThreshold ?? DEFAULT_MAINTENANCE_SCRAPE_COOLDOWN_CONFIG.scrapeSoftBlockThreshold,
    cooldownMs: runtimeConfig?.scrapeSoftBlockCooldownMs ?? DEFAULT_MAINTENANCE_SCRAPE_COOLDOWN_CONFIG.scrapeSoftBlockCooldownMs,
  });
}

function makeScopeRuntime(shared, parentState) {
  return function scopeRuntime({
    signal = parentState.signal,
    deadlineAt = parentState.deadlineAt,
    correlationId = parentState.correlationId,
  } = {}) {
    const scopedBrowser = createScopedBrowserPort(shared.bundle.browser);
    const scopedPorts = Object.freeze({ ...shared.basePorts, browser: scopedBrowser });
    const closeScope = async () => {
      shared.childClosers.delete(closeScope);
      await scopedBrowser.closeAll();
    };
    shared.childClosers.add(closeScope);

    return createRuntimeView(shared, {
      ports: scopedPorts,
      signal,
      deadlineAt,
      correlationId,
      closeAll: closeScope,
    });
  };
}

function createRuntimeView(shared, viewState) {
  const { ports, signal = null, deadlineAt = null, correlationId = null, closeAll } = viewState;
  const scopeRuntime = makeScopeRuntime(shared, { signal, deadlineAt, correlationId });

  return Object.freeze({
    mode: shared.parsedEnv.mode,
    runtimeConfig: shared.runtimeConfig,
    env: shared.parsedEnv,
    ports,
    outputSink: shared.outputSink,
    clock: shared.clock,
    seal: shared.seal,
    endpointState: shared.endpointState,
    scrapeCooldown: shared.scrapeCooldown,
    daemonIsRunning: shared.daemonIsRunning,
    passwordLogin: shared.bundle.passwordLogin,
    loadFixture: shared.bundle.loadFixture,
    fixture: shared.bundle.fixture,
    signal,
    deadlineAt,
    correlationId,
    scopeRuntime,
    closeAll,
  });
}

function registerRootCloser({ childClosers, rootBrowser, bundleBrowser }) {
  let unregisterCleanupHook = () => {};
  const closeAll = async () => {
    unregisterCleanupHook();
    unregisterCleanupHook = () => {};
    const scoped = [...childClosers];
    childClosers.clear();
    await Promise.allSettled([
      ...scoped.map((fn) => fn()),
      rootBrowser.closeAll(),
      typeof bundleBrowser.closeAll === 'function' ? bundleBrowser.closeAll() : Promise.resolve(),
    ]);
  };
  unregisterCleanupHook = registerCloseAllHook(closeAll);
  return closeAll;
}

export async function composeCommandRuntime({
  mode,
  env = process.env,
  overrides = {},
  streams,
  clock: customClock,
  configOptions = {},
  runtimeConfigPolicy = 'required',
} = {}) {
  const parsedEnv = parseRuntimeEnv(env, { mode });
  const clock = resolveClock(customClock);
  const seal = overrides.seal ?? createCandidateSeal();
  const outputSink = overrides.outputSink ?? createOutputSink({ streams, debugRaw: parsedEnv.debugRaw });
  const runtimeConfig = await resolveCommandRuntimeConfig({ runtimeConfigPolicy, configOptions, env, overrides });
  const bundle = await loadCommandBundle({ parsedEnv, seal, clock, env, overrides });
  const { endpointState, endpointPort } = createCommandEndpointPort({
    runtimeConfig,
    transport: bundle.endpointTransport,
    clock,
    overrides,
  });
  const scrapeCooldown = createCommandScrapeCooldown({ parsedEnv, runtimeConfig, clock, overrides });

  const rootBrowser = createScopedBrowserPort(bundle.browser);
  const goodsPublish = overrides.goodsPublish ?? bundle.createGoodsPublishPort?.({
    parsedEnv,
    runtimeConfig,
    clock,
    browserPort: rootBrowser,
    endpointPort,
    scrapeCooldown,
  }) ?? null;
  const basePorts = Object.freeze({
    browser: rootBrowser,
    mall: bundle.mall,
    auth: bundle.auth,
    daemonProcess: bundle.daemonProcess,
    endpoint: endpointPort,
    goodsPublish,
  });
  const daemonIsRunning = typeof overrides.daemonIsRunning === 'function'
    ? overrides.daemonIsRunning
    : defaultDaemonIsRunning;
  const childClosers = new Set();
  const closeAll = registerRootCloser({ childClosers, rootBrowser, bundleBrowser: bundle.browser });

  return createRuntimeView({
    parsedEnv,
    runtimeConfig,
    outputSink,
    clock,
    seal,
    endpointState,
    scrapeCooldown,
    daemonIsRunning,
    bundle,
    basePorts,
    childClosers,
  }, { ports: basePorts, closeAll });
}
