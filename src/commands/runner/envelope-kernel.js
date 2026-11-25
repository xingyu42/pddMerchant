// 统一命令执行与信封内核：presets 校验、动态命令名、noColor、协作超时与单次发射守门。
import { randomUUID } from 'node:crypto';
import { getLogger } from '../../infra/logger.js';
import { emit as defaultEmit } from '../../infra/output.js';
import { PddCliError, ExitCodes, errorToEnvelope } from '../../infra/errors.js';
import { armDeadline } from '../../infra/abort.js';
import { composeCommandRuntime } from '../../runtime/command-runtime.js';

const VALID_LIFECYCLES = new Set(['merchant', 'local', 'maintenance']);
const VALID_MERCHANT_MALL = new Set(['none', 'current', 'switch']);
const VALID_LOCAL_MALL = new Set(['none', 'stored']);

function invalidSpecError(message, detail = {}) {
  return new PddCliError({
    code: 'E_CONFIG_INVALID',
    message,
    detail: { source: 'command_spec', ...detail },
    exitCode: ExitCodes.GENERAL,
  });
}

export function normalizeNeedsAccount(value) {
  if (value === undefined) return undefined;
  if (value === false) return 'none';
  if (value === true) return 'required';
  if (value === 'none' || value === 'optional' || value === 'required') return value;
  throw invalidSpecError(`Invalid needsAccount value: ${String(value)}`);
}

function resolveLifecycle(rawSpec) {
  if (rawSpec.lifecycle !== undefined) {
    if (!VALID_LIFECYCLES.has(rawSpec.lifecycle)) {
      throw invalidSpecError(`Invalid lifecycle preset: ${String(rawSpec.lifecycle)}`);
    }
    return rawSpec.lifecycle;
  }
  return rawSpec.needsBrowser === false ? 'local' : 'merchant';
}

function validateTimeoutOption(defaultTimeoutMs) {
  if (defaultTimeoutMs === undefined || typeof defaultTimeoutMs === 'function') return;
  if (typeof defaultTimeoutMs !== 'number' || !Number.isFinite(defaultTimeoutMs) || defaultTimeoutMs <= 0) {
    throw invalidSpecError('defaultTimeoutMs must be a positive finite number or function');
  }
}

function resolveCommandDeclaration(rawSpec) {
  if (rawSpec.command !== undefined && rawSpec.name !== undefined) {
    throw invalidSpecError('withCommand accepts either command or name, not both');
  }
  const commandDecl = rawSpec.command ?? rawSpec.name;
  if (typeof commandDecl === 'string') {
    if (!commandDecl.trim()) throw invalidSpecError('Command name must be a non-empty string');
    return { commandDecl: commandDecl.trim(), fallbackName: commandDecl.trim() };
  }
  if (typeof commandDecl === 'function') {
    return { commandDecl, fallbackName: 'pdd' };
  }
  throw invalidSpecError('withCommand requires a command name or function');
}

function normalizeMaintenanceSpec(rawSpec, parsedAccount) {
  if (rawSpec.needsAuth === true) throw invalidSpecError('maintenance lifecycle cannot set needsAuth: true');
  if (rawSpec.needsBrowser === true) throw invalidSpecError('maintenance lifecycle cannot set needsBrowser: true');
  if (parsedAccount !== undefined && parsedAccount !== 'none') {
    throw invalidSpecError('maintenance lifecycle cannot require or resolve accounts');
  }
  if (rawSpec.needsMall !== undefined && rawSpec.needsMall !== 'none') {
    throw invalidSpecError('maintenance lifecycle cannot declare needsMall');
  }
  if (rawSpec.allowAllAccounts === true) {
    throw invalidSpecError('maintenance lifecycle cannot allow --all-accounts');
  }
  return {
    runtimeConfigPolicy: 'maintenance',
    needsBrowser: false,
    needsAuth: false,
    needsAccount: 'none',
    needsMall: 'none',
    allowAllAccounts: false,
  };
}

function normalizeLocalSpec(rawSpec, parsedAccount) {
  if (rawSpec.needsBrowser === true) throw invalidSpecError('local lifecycle cannot set needsBrowser: true');
  if (rawSpec.needsAuth === true) throw invalidSpecError('local lifecycle cannot set needsAuth: true');
  if (rawSpec.allowAllAccounts === true) {
    throw invalidSpecError('local lifecycle cannot allow --all-accounts');
  }
  const needsMall = rawSpec.needsMall ?? 'none';
  if (!VALID_LOCAL_MALL.has(needsMall)) {
    throw invalidSpecError(`local lifecycle does not support needsMall: ${String(needsMall)}`);
  }
  const needsAccount = parsedAccount ?? 'none';
  if (needsMall === 'stored' && needsAccount !== 'required') {
    throw invalidSpecError("needsMall: 'stored' requires needsAccount: 'required'");
  }
  return {
    runtimeConfigPolicy: 'required',
    needsBrowser: false,
    needsAuth: false,
    needsAccount,
    needsMall,
    allowAllAccounts: false,
  };
}

function normalizeMerchantSpec(rawSpec, parsedAccount) {
  if (rawSpec.needsBrowser === false) {
    throw invalidSpecError('merchant lifecycle cannot set needsBrowser: false');
  }
  const needsAuth = rawSpec.needsAuth ?? true;
  if (needsAuth && parsedAccount !== undefined && parsedAccount !== 'required') {
    throw invalidSpecError('needsAuth: true requires account resolution');
  }
  const needsMall = rawSpec.needsMall ?? 'current';
  if (!VALID_MERCHANT_MALL.has(needsMall)) {
    throw invalidSpecError(`merchant lifecycle does not support needsMall: ${String(needsMall)}`);
  }
  return {
    runtimeConfigPolicy: 'required',
    needsBrowser: true,
    needsAuth,
    needsAccount: parsedAccount ?? (needsAuth ? 'required' : 'optional'),
    needsMall,
    allowAllAccounts: rawSpec.allowAllAccounts ?? true,
  };
}

export function normalizeCommandSpec(rawSpec) {
  if (!rawSpec || typeof rawSpec !== 'object') {
    throw invalidSpecError('withCommand requires a specification object');
  }
  if (typeof rawSpec.run !== 'function') {
    throw invalidSpecError('withCommand requires a run() function');
  }
  const { commandDecl, fallbackName } = resolveCommandDeclaration(rawSpec);
  validateTimeoutOption(rawSpec.defaultTimeoutMs);
  if (rawSpec.needsBrowser === false && rawSpec.needsAuth === true) {
    throw invalidSpecError('needsBrowser: false cannot be combined with needsAuth: true');
  }
  const parsedAccount = normalizeNeedsAccount(rawSpec.needsAccount);
  const lifecycle = resolveLifecycle(rawSpec);

  let presetFields;
  if (lifecycle === 'maintenance') presetFields = normalizeMaintenanceSpec(rawSpec, parsedAccount);
  else if (lifecycle === 'local') presetFields = normalizeLocalSpec(rawSpec, parsedAccount);
  else presetFields = normalizeMerchantSpec(rawSpec, parsedAccount);

  return Object.freeze({
    name: commandDecl,
    command: commandDecl,
    fallbackName,
    lifecycle,
    ...presetFields,
    defaultTimeoutMs: rawSpec.defaultTimeoutMs,
    run: rawSpec.run,
    render: rawSpec.render,
  });
}

export function resolveCommandName(spec, opts = {}) {
  const decl = spec?.command ?? spec?.name;
  if (typeof decl === 'function') {
    try {
      const evaluated = decl(opts ?? {});
      if (typeof evaluated === 'string' && evaluated.trim()) return evaluated.trim();
    } catch {
      return spec?.fallbackName ?? 'pdd';
    }
    return spec?.fallbackName ?? 'pdd';
  }
  if (typeof decl === 'string' && decl.trim()) return decl.trim();
  return spec?.fallbackName ?? 'pdd';
}

export function resolveNoColor(opts = {}) {
  return Boolean(opts?.noColor) || opts?.color === false;
}

export function resolveEffectiveTimeoutMs(spec, opts = {}) {
  if (typeof opts?.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0) {
    return opts.timeoutMs;
  }
  const defaultTimeout = spec?.defaultTimeoutMs;
  if (typeof defaultTimeout === 'function') {
    try {
      const evaluated = defaultTimeout(opts ?? {});
      if (typeof evaluated === 'number' && Number.isFinite(evaluated) && evaluated > 0) {
        return evaluated;
      }
    } catch {
      return undefined;
    }
  }
  if (typeof defaultTimeout === 'number' && Number.isFinite(defaultTimeout) && defaultTimeout > 0) {
    return defaultTimeout;
  }
  return undefined;
}

function assertAllAccountsAllowed(spec, opts, commandName) {
  if (!opts?.allAccounts || spec.allowAllAccounts) return;
  throw new PddCliError({
    code: 'E_USAGE',
    message: `${commandName} does not support --all-accounts`,
    hint: spec.lifecycle === 'merchant'
      ? '写操作不支持批量账号执行，请指定单一账号'
      : '该命令不支持 --all-accounts 批量账号执行',
    exitCode: ExitCodes.USAGE,
  });
}

function emitFallbackError(envelope, { sink, opts, noColor }) {
  const emitOptions = { json: Boolean(opts?.json), noColor };
  if (sink) {
    if (!sink.hasEmitted()) sink.emit(envelope, emitOptions);
    return envelope;
  }
  defaultEmit(envelope, emitOptions);
  return envelope;
}

function buildKernelRuntime({
  composedRuntime,
  providedOutputSink,
  configOptions,
  runtimeConfig,
  opts,
  noColor,
  effectiveTimeoutMs,
  startedAt,
  correlationId,
  warnings,
  log,
  deadline,
}) {
  const mergedConfigOptions = configOptions !== undefined
    ? { ...(composedRuntime.configOptions ?? {}), ...configOptions }
    : composedRuntime.configOptions;
  return {
    ...composedRuntime,
    ...(providedOutputSink ? { outputSink: providedOutputSink } : {}),
    ...(mergedConfigOptions !== undefined ? { configOptions: mergedConfigOptions } : {}),
    runtimeConfig: runtimeConfig ?? composedRuntime.runtimeConfig,
    opts: { ...opts, noColor, ...(effectiveTimeoutMs !== undefined ? { timeoutMs: effectiveTimeoutMs } : {}) },
    emitResult: true,
    startedAt,
    correlationId,
    warnings,
    log,
    signal: deadline.signal,
    get deadlineAt() { return deadline.deadlineAt; },
    deadline,
  };
}

export async function runWithEnvelopeKernel(spec, opts = {}, extra = {}, executeBranch) {
  const {
    runtimeConfig,
    runtime: providedRuntime = null,
    configOptions,
    outputSink: providedOutputSink,
    parentSignal,
  } = extra ?? {};
  const commandName = resolveCommandName(spec, opts);
  const noColor = resolveNoColor(opts);
  const selfComposed = !providedRuntime;
  let composedRuntime = providedRuntime;
  let startedAt = Date.now();
  let correlationId = opts._correlationId ?? providedRuntime?.correlationId ?? randomUUID();
  const warnings = [];
  let deadline;

  try {
    if (!composedRuntime) {
      composedRuntime = await composeCommandRuntime({
        env: process.env,
        runtimeConfigPolicy: spec.runtimeConfigPolicy,
        ...(configOptions !== undefined ? { configOptions } : {}),
        overrides: {
          ...(runtimeConfig !== undefined ? { runtimeConfig } : {}),
          ...(providedOutputSink ? { outputSink: providedOutputSink } : {}),
        },
      });
      correlationId = opts._correlationId ?? composedRuntime.correlationId ?? correlationId;
    }
    startedAt = composedRuntime.clock.now();
    const log = getLogger().withOp
      ? getLogger().withOp({ command: commandName, correlation_id: correlationId })
      : getLogger();

    assertAllAccountsAllowed(spec, opts, commandName);

    const effectiveTimeoutMs = resolveEffectiveTimeoutMs(spec, opts);
    const deadlineOpts = effectiveTimeoutMs !== undefined ? { ...opts, timeoutMs: effectiveTimeoutMs } : opts;
    deadline = armDeadline(deadlineOpts, parentSignal ?? composedRuntime.signal ?? opts.signal, startedAt, composedRuntime.clock);

    const resolvedRuntime = buildKernelRuntime({
      composedRuntime,
      providedOutputSink,
      configOptions,
      runtimeConfig,
      opts,
      noColor,
      effectiveTimeoutMs,
      startedAt,
      correlationId,
      warnings,
      log,
      deadline,
    });

    return await executeBranch({
      spec: { ...spec, name: commandName },
      opts: resolvedRuntime.opts,
      runtime: resolvedRuntime,
    });
  } catch (err) {
    const clockNow = composedRuntime?.clock?.now ? composedRuntime.clock.now() : Date.now();
    const envelope = errorToEnvelope(commandName, err, {
      latency_ms: Math.max(0, clockNow - startedAt),
      warnings,
      correlation_id: correlationId,
    });
    return emitFallbackError(envelope, {
      sink: providedOutputSink ?? composedRuntime?.outputSink,
      opts,
      noColor,
    });
  } finally {
    deadline?.dispose();
    if (selfComposed && composedRuntime) await composedRuntime.closeAll();
  }
}
