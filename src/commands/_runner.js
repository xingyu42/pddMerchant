import { randomUUID } from 'node:crypto';
import { getLogger } from '../infra/logger.js';
import { emit, buildBatchEnvelope, batchRenderer } from '../infra/output.js';
import { PddCliError, ExitCodes, errorToEnvelope, batchExitCode } from '../infra/errors.js';
import { abortableSleep } from '../infra/abort.js';
import { ensureDaemonRunning } from '../infra/daemon-launcher.js';
import { listAccounts } from '../infra/account-registry.js';
import { accountAuthStatePath } from '../infra/paths.js';
import { executeSingle } from './runner/single-lifecycle.js';

export { executeSingle };

const BATCH_JITTER_MIN = 2000;
const BATCH_JITTER_MAX = 5000;
function batchJitter() {
  return BATCH_JITTER_MIN + Math.floor(Math.random() * (BATCH_JITTER_MAX - BATCH_JITTER_MIN));
}

async function executeBatch(spec, opts) {
  const startedAt = Date.now();
  const batchCorrelationId = randomUUID();
  const batchWarnings = [];

  const log = getLogger().withOp
    ? getLogger().withOp({ command: spec.name, correlation_id: batchCorrelationId })
    : getLogger();

  if (opts.account) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: '--all-accounts and --account are mutually exclusive',
      hint: 'Use one or the other, not both',
      exitCode: ExitCodes.USAGE,
    });
  }
  if (opts.authStatePath || process.env.PDD_AUTH_STATE_PATH) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: '--all-accounts and --auth-state-path / PDD_AUTH_STATE_PATH are mutually exclusive',
      hint: 'Use --all-accounts alone to iterate registered accounts',
      exitCode: ExitCodes.USAGE,
    });
  }

  if (opts.mall) {
    batchWarnings.push('unused_flag_mall_in_batch');
  }

  const allAccounts = await listAccounts({ includeDisabled: true });
  if (allAccounts.length === 0) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: 'No registered accounts found',
      hint: 'Run "pdd account add" to register an account first',
      exitCode: ExitCodes.USAGE,
    });
  }
  const accounts = allAccounts.filter((a) => !a.disabled);

  if (accounts.length === 0) {
    const emptyEnvelope = buildBatchEnvelope(spec.name, {}, {
      latency_ms: Date.now() - startedAt,
      correlation_id: batchCorrelationId,
      exit_code: ExitCodes.OK,
      warnings: [...new Set(batchWarnings)],
    });
    emit(emptyEnvelope, { json: opts.json, noColor: opts.noColor });
    return emptyEnvelope;
  }

  ensureDaemonRunning().catch((err) => {
    log.debug({ err: err?.message }, 'auto-start daemon failed (non-fatal)');
  });

  const batchAbortController = new AbortController();
  const onSigint = () => batchAbortController.abort();
  process.prependListener('SIGINT', onSigint);

  const accountResults = {};
  try {
    for (let i = 0; i < accounts.length; i++) {
      if (batchAbortController.signal.aborted) break;

      const acct = accounts[i];
      const slug = acct.slug;
      const perAccountCorrelation = `${batchCorrelationId}:${slug}`;

      log.info({ slug, index: i, total: accounts.length }, 'batch: executing account');

      const perOpts = {
        ...opts,
        account: undefined,
        authStatePath: accountAuthStatePath(slug),
        allAccounts: false,
        mall: undefined,
        _correlationId: perAccountCorrelation,
      };

      const envelope = await executeSingle(spec, perOpts, {
        emitResult: false,
        skipDaemonStart: true,
        parentSignal: batchAbortController.signal,
      }).catch((err) => errorToEnvelope(spec.name, err, {
        latency_ms: Date.now() - startedAt,
        correlation_id: perAccountCorrelation,
      }));

      accountResults[slug] = {
        ok: envelope.ok,
        data: envelope.data,
        error: envelope.error,
        exit_code: envelope.meta?.exit_code ?? ExitCodes.GENERAL,
        latency_ms: envelope.meta?.latency_ms ?? 0,
        command: envelope.command,
        meta: envelope.meta,
      };

      if (envelope.meta?.warnings) {
        for (const w of envelope.meta.warnings) batchWarnings.push(w);
      }

      if (i < accounts.length - 1 && !batchAbortController.signal.aborted) {
        try {
          await abortableSleep(batchJitter(), batchAbortController.signal);
        } catch {
          break;
        }
      }
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
  }

  if (batchAbortController.signal.aborted) {
    batchWarnings.push('batch_interrupted_sigint');
  }

  const dedupedWarnings = [...new Set(batchWarnings)];
  const exitCode = batchAbortController.signal.aborted ? 130 : batchExitCode(accountResults);

  const batchEnvelope = buildBatchEnvelope(spec.name, accountResults, {
    latency_ms: Date.now() - startedAt,
    correlation_id: batchCorrelationId,
    exit_code: exitCode,
    warnings: dedupedWarnings,
  });

  emit(batchEnvelope, {
    json: opts.json,
    noColor: opts.noColor,
    renderer: (env, renderOpts) => batchRenderer(accountResults, renderOpts),
  });

  if (batchAbortController.signal.aborted) {
    process.exitCode = 130;
  }

  return batchEnvelope;
}

export function withCommand({
  name,
  needsAuth = true,
  needsMall = 'current',
  allowAllAccounts = true,
  run,
  render,
}) {
  const spec = { name, needsAuth, needsMall, run, render };
  return function executeCommand(opts = {}) {
    if (opts.allAccounts && !allowAllAccounts) {
      throw new PddCliError({
        code: 'E_USAGE',
        message: `${name} does not support --all-accounts`,
        hint: '写操作不支持批量账号执行，请指定单一账号',
        exitCode: ExitCodes.USAGE,
      });
    }
    if (opts.allAccounts && needsAuth) {
      return executeBatch(spec, opts);
    }
    return executeSingle(spec, opts, { emitResult: true, skipDaemonStart: false });
  };
}
