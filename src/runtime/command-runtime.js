import { loadRuntimeConfig } from '../infra/config.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { resolveClock } from '../infra/clock.js';
import { createOutputSink } from '../infra/output-sink.js';
import { createCandidateSeal } from '../infra/candidate-seal.js';
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

async function resolveCommandRuntimeConfig({ runtimeConfigPolicy, configOptions, rawEnv, overrides }) {
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
    env: rawEnv,
    ...configOptions,
  });
  return overrides.runtimeConfig ? { ...loaded, ...overrides.runtimeConfig } : loaded;
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
  const outputSink = overrides.outputSink ?? createOutputSink({
    streams,
    debugRaw: parsedEnv.debugRaw,
  });

  const runtimeConfig = await resolveCommandRuntimeConfig({
    runtimeConfigPolicy,
    configOptions,
    rawEnv: env,
    overrides,
  });

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

  const effectiveEndpointConfig = {
    ...DEFAULT_MAINTENANCE_ENDPOINT_CONFIG,
    ...(runtimeConfig ?? {}),
  };
  const endpointState = overrides.endpointState ?? createEndpointRuntimeState(effectiveEndpointConfig);
  const endpointPort = overrides.endpoint ?? createCommandEndpointClient({
    runtimeConfig: effectiveEndpointConfig,
    transport: bundle.endpointTransport,
    endpointState,
    clock,
  });

  const rootBrowser = createScopedBrowserPort(bundle.browser);
  const basePorts = Object.freeze({
    browser: rootBrowser,
    mall: bundle.mall,
    auth: bundle.auth,
    daemonProcess: bundle.daemonProcess,
    endpoint: endpointPort,
  });

  const daemonIsRunning = typeof overrides.daemonIsRunning === 'function'
    ? overrides.daemonIsRunning
    : defaultDaemonIsRunning;

  const childClosers = new Set();

  function createRuntimeView({
    ports,
    signal = null,
    deadlineAt = null,
    correlationId = null,
    closeAll,
  }) {
    function scopeRuntime({
      signal: scopedSignal = signal,
      deadlineAt: scopedDeadlineAt = deadlineAt,
      correlationId: scopedCorrelationId = correlationId,
    } = {}) {
      const scopedBrowser = createScopedBrowserPort(bundle.browser);
      const scopedPorts = Object.freeze({
        ...basePorts,
        browser: scopedBrowser,
      });

      const closeScope = async () => {
        childClosers.delete(closeScope);
        await scopedBrowser.closeAll();
      };
      childClosers.add(closeScope);

      return createRuntimeView({
        ports: scopedPorts,
        signal: scopedSignal,
        deadlineAt: scopedDeadlineAt,
        correlationId: scopedCorrelationId,
        closeAll: closeScope,
      });
    }

    return Object.freeze({
      mode: parsedEnv.mode,
      runtimeConfig,
      env: parsedEnv,
      rawEnv: env,
      ports,
      outputSink,
      clock,
      seal,
      endpointState,
      daemonIsRunning,
      loadFixture: bundle.loadFixture,
      fixture: bundle.fixture,
      signal,
      deadlineAt,
      correlationId,
      scopeRuntime,
      closeAll,
    });
  }

  let unregisterCleanupHook = () => {};
  const closeAll = async () => {
    unregisterCleanupHook();
    unregisterCleanupHook = () => {};
    const scoped = [...childClosers];
    childClosers.clear();
    await Promise.allSettled([
      ...scoped.map((fn) => fn()),
      rootBrowser.closeAll(),
      typeof bundle.browser.closeAll === 'function' ? bundle.browser.closeAll() : Promise.resolve(),
    ]);
  };
  unregisterCleanupHook = registerCloseAllHook(closeAll);

  return createRuntimeView({
    ports: basePorts,
    closeAll,
  });
}
