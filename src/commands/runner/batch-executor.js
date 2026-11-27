// 批量执行器（design D-2）：--all-accounts 账号循环、jitter、SIGINT 中断与
// batch envelope 终结。withCommand 同时分派 single/batch，依 DAG 只能住本模块。
import { emit as defaultEmit, buildBatchEnvelope, batchRenderer } from '../../infra/output.js';
import { PddCliError, ExitCodes, errorToEnvelope, batchExitCode } from '../../infra/errors.js';
import { throwIfAborted } from '../../infra/abort.js';
import { listAccounts } from '../../infra/account-store.js';
import { executeSingle } from './single-lifecycle.js';
import { normalizeCommandSpec, resolveNoColor, runWithEnvelopeKernel } from './envelope-kernel.js';

const BATCH_JITTER_MIN = 2000;
const BATCH_JITTER_MAX = 5000;

const COOLDOWN_INHERITED_PREFIX = 'cooldown_inherited_from:';
const COOLDOWN_GLOBAL_KEY = '*';

function applyCooldownAttribution(result, slug, sourcesByEndpoint) {
  if (result?.ok !== false || result.error?.code !== 'E_RATE_LIMIT') return sourcesByEndpoint;
  const endpoint = result.error.detail?.endpoint ?? COOLDOWN_GLOBAL_KEY;
  if (result.error.detail?.cooldown_triggered !== true) {
    return { ...sourcesByEndpoint, [endpoint]: slug };
  }

  const source = sourcesByEndpoint[endpoint] ?? sourcesByEndpoint[COOLDOWN_GLOBAL_KEY];
  if (source && source !== slug) {
    const warning = `${COOLDOWN_INHERITED_PREFIX}${source}`;
    if (Array.isArray(result.meta?.warnings)) {
      result.meta.warnings.push(warning);
    } else {
      result.meta = { ...result.meta, warnings: [warning] };
    }
  }
  return sourcesByEndpoint;
}

function listMerchantAccounts() {
  const accounts = listAccounts({ kind: 'merchant' });
  if (accounts.length === 0) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: 'No registered accounts found',
      hint: 'Run "pdd login" to register an account first',
      exitCode: ExitCodes.USAGE,
    });
  }
  return accounts;
}

function validateBatchOptions(opts) {
  if (opts.account) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: '--all-accounts and --account are mutually exclusive',
      hint: 'Use one or the other, not both',
      exitCode: ExitCodes.USAGE,
    });
  }

  return opts.mall ? ['unused_flag_mall_in_batch'] : [];
}

function buildPerAccountOptions(opts, account, batch) {
  return {
    ...opts,
    account: undefined,
    accountId: account.id,
    allAccounts: false,
    mall: undefined,
    _correlationId: `${batch.correlationId}:${account.slug}`,
  };
}

function batchJitterMs(random = Math.random) {
  return BATCH_JITTER_MIN + Math.floor(random() * (BATCH_JITTER_MAX - BATCH_JITTER_MIN));
}

function appendBatchWarnings(target, warnings) {
  for (const warning of warnings) {
    if (warning?.code === 'daemon_not_running' && target.some((entry) => entry?.code === warning.code)) continue;
    target.push(warning);
  }
}

async function runOneAccount(spec, opts, account, batch, runtimeConfig) {
  const perOpts = buildPerAccountOptions(opts, account, batch);
  const perAccountCorrelation = perOpts._correlationId;
  const scopedRuntime = batch.runtime.scopeRuntime({
    signal: batch.signal,
    correlationId: perAccountCorrelation,
  });

  try {
    const envelope = await executeSingle(spec, perOpts, {
      emitResult: false,
      parentSignal: batch.signal,
      parentDeadline: batch.runtime.deadline,
      runtime: scopedRuntime,
      ...(runtimeConfig !== undefined ? { runtimeConfig } : {}),
    }).catch((err) => errorToEnvelope(spec.name, err, {
      latency_ms: batch.runtime.clock.now() - batch.startedAt,
      correlation_id: perAccountCorrelation,
    }));

    return {
      ok: envelope.ok,
      data: envelope.data,
      error: envelope.error,
      exit_code: envelope.meta?.exit_code ?? ExitCodes.GENERAL,
      latency_ms: envelope.meta?.latency_ms ?? 0,
      command: envelope.command,
      meta: envelope.meta,
    };
  } finally {
    await scopedRuntime.closeAll();
  }
}

async function runAccountLoop(spec, opts, accounts, batch, runtimeConfig) {
  const accountResults = {};
  let cooldownSources = {};
  for (let i = 0; i < accounts.length; i++) {
    if (batch.signal.aborted) break;

    const slug = accounts[i].slug;
    batch.log.info({ slug, index: i, total: accounts.length }, 'batch: executing account');

    const result = await runOneAccount(spec, opts, accounts[i], batch, runtimeConfig);
    cooldownSources = applyCooldownAttribution(result, slug, cooldownSources);
    accountResults[slug] = result;

    if (result.meta?.warnings) {
      appendBatchWarnings(batch.warnings, result.meta.warnings);
    }

    if (i < accounts.length - 1 && !batch.signal.aborted) {
      try {
        await batch.runtime.clock.sleep(batchJitterMs(), batch.signal);
      } catch {
        break;
      }
    }
  }
  return accountResults;
}

function finalizeBatch(spec, opts, accountResults, batch, interruptedBySigint = false) {
  if (interruptedBySigint) {
    batch.warnings.push('batch_interrupted_sigint');
  }

  const batchEnvelope = buildBatchEnvelope(
    spec.name,
    accountResults,
    {
      latency_ms: batch.runtime.clock.now() - batch.startedAt,
      correlation_id: batch.correlationId,
      exit_code: interruptedBySigint ? 130 : batchExitCode(accountResults),
      warnings: [...new Set(batch.warnings)],
    },
    {
      debugRaw: Boolean(batch.runtime.env?.debugRaw),
      onRawDebug: typeof batch.runtime.outputSink?.writeDebugRaw === 'function'
        ? (entry) => batch.runtime.outputSink.writeDebugRaw(entry)
        : undefined,
    },
  );

  const emitFn = batch.runtime.outputSink?.emit ?? defaultEmit;
  emitFn(batchEnvelope, {
    json: Boolean(opts.json),
    noColor: resolveNoColor(opts),
    renderer: (env, renderOpts) => [
      ...(env.data?.headline ?? []),
      batchRenderer(accountResults, renderOpts),
    ].join('\n'),
  });

  if (interruptedBySigint) {
    process.exitCode = 130;
  }

  return batchEnvelope;
}

async function executeBatch(spec, opts, runtime) {
  const warnings = validateBatchOptions(opts);
  runtime.warnings.push(...warnings);
  throwIfAborted(runtime.signal);
  const accounts = listMerchantAccounts();

  const abortController = new AbortController();
  let interruptedBySigint = false;
  const parentSignal = runtime.signal;
  const onParentAbort = () => abortController.abort(parentSignal.reason);
  const onSigint = () => {
    interruptedBySigint = true;
    abortController.abort();
  };
  if (parentSignal?.aborted) {
    abortController.abort(parentSignal.reason);
  } else {
    parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  }
  process.prependListener('SIGINT', onSigint);

  const batch = {
    startedAt: runtime.startedAt,
    correlationId: runtime.correlationId,
    warnings: runtime.warnings,
    log: runtime.log,
    signal: abortController.signal,
    runtime,
  };
  let accountResults;
  try {
    accountResults = await runAccountLoop(spec, opts, accounts, batch, runtime.runtimeConfig);
  } finally {
    process.removeListener('SIGINT', onSigint);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }

  if (!interruptedBySigint) throwIfAborted(parentSignal);
  return finalizeBatch(spec, opts, accountResults, batch, interruptedBySigint);
}

export function withCommand(rawSpec) {
  const spec = normalizeCommandSpec(rawSpec);
  async function executeCommand(opts = {}, extra = {}) {
    return runWithEnvelopeKernel(spec, opts, extra, async ({ spec: resolvedSpec, opts: resolvedOpts, runtime }) => {
      if (resolvedOpts.allAccounts && resolvedSpec.needsAuth) {
        return executeBatch(resolvedSpec, resolvedOpts, runtime);
      }
      return executeSingle(resolvedSpec, resolvedOpts, {
        emitResult: true,
        parentSignal: runtime.signal,
        runtimeConfig: runtime.runtimeConfig,
        runtime,
      });
    });
  }
  executeCommand.runtimeConfigPolicy = spec.runtimeConfigPolicy;
  executeCommand.lifecycle = spec.lifecycle;
  return executeCommand;
}
