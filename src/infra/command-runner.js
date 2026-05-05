import { randomUUID } from 'node:crypto';
import { withBrowser } from '../adapter/browser.js';
import { isAuthValid, loadAuthState, migrateLegacyAuthStateIfNeeded } from '../adapter/auth-state.js';
import { currentMall, resolveMallContext } from '../adapter/mall-reader.js';
import { switchTo } from '../adapter/mall-writer.js';
import { FixtureEndpointClient, mockCurrentMall, mockListMalls } from '../adapter/mock-dispatcher.js';
import { getSharedClient } from '../adapter/rate-limiter-singleton.js';
import { createPageSession } from '../adapter/page-session.js';
import { createLogger, getLogger } from '../infra/logger.js';
import { emit, buildEnvelope, buildBatchEnvelope, batchRenderer } from '../infra/output.js';
import { PddCliError, ExitCodes, errorToEnvelope, batchExitCode } from '../infra/errors.js';
import { AUTH_STATE_PATH } from '../infra/paths.js';
import { resolveAccountContext, accountMetaForEnvelope } from '../infra/account-resolver.js';
import { isMockEnabled } from '../adapter/mock-dispatcher.js';
import { remainingMs, throwIfAborted, timeoutError, abortableSleep } from '../infra/abort.js';
import { ensureDaemonRunning } from '../infra/daemon-launcher.js';
import { listAccounts } from '../infra/account-registry.js';
import { accountAuthStatePath } from '../infra/paths.js';

function normalizeRunResult(result) {
  if (result == null) return { data: null };
  if (typeof result !== 'object' || Array.isArray(result)) return { data: result };

  const hasReservedShape = 'data' in result || 'meta' in result || 'warnings' in result;
  if (hasReservedShape) {
    return {
      data: result.data ?? null,
      meta: result.meta,
      warnings: result.warnings,
    };
  }
  return { data: result };
}

export async function executeSingle(spec, opts = {}, { emitResult = true, skipDaemonStart = false, parentSignal } = {}) {
  const { name, needsAuth = true, needsMall = 'current', run, render } = spec;
  const startedAt = Date.now();
  const correlationId = opts._correlationId ?? randomUUID();
  const warnings = [];

  const log = getLogger().withOp
    ? getLogger().withOp({ command: name, correlation_id: correlationId })
    : getLogger();

  const authPath = opts.authStatePath ?? AUTH_STATE_PATH;

  let accountCtx = null;
  try {
    accountCtx = await resolveAccountContext({
      account: opts.account,
      authStatePath: opts.authStatePath,
      needsAuth,
      warnings,
    });
  } catch (resolveErr) {
    if (resolveErr instanceof PddCliError) throw resolveErr;
    log.debug({ err: resolveErr?.message }, 'account resolution failed, falling back');
  }
  const resolvedAuthPath = accountCtx?.authPath ?? authPath;

  let abortController = null;
  let deadlineTimer = null;
  if (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0) {
    abortController = new AbortController();
    deadlineTimer = setTimeout(() => abortController.abort(), opts.timeoutMs);
  }
  const signal = parentSignal ?? abortController?.signal ?? null;
  const deadlineAt = signal ? startedAt + (opts.timeoutMs ?? Infinity) : null;

  try {

  await migrateLegacyAuthStateIfNeeded(resolvedAuthPath, warnings).catch((err) => {
    log.debug({ err: err?.message }, 'legacy auth migration check failed');
  });

  if (needsMall === 'none' && opts.mall) {
    log.warn({ mall: opts.mall }, 'command does not use --mall flag');
    warnings.push('unused_flag_mall');
  }

  const useFixture = isMockEnabled();

  if (useFixture) {
    if (needsAuth && process.env.PDD_TEST_AUTH_INVALID === '1') {
      const envelope = errorToEnvelope(name, new PddCliError({
        code: 'E_AUTH_EXPIRED',
        message: '登录态失效',
        hint: '执行 pdd login 重新登录',
        exitCode: ExitCodes.AUTH,
      }), {
        latency_ms: Date.now() - startedAt,
        warnings,
        correlation_id: correlationId,
      });
      if (emitResult) emit(envelope, { json: opts.json, noColor: opts.noColor });
      return envelope;
    }

    const client = new FixtureEndpointClient();

    let mallCtx = null;
    if (needsMall === 'current' || needsMall === 'switch') {
      try {
        const current = await mockCurrentMall();
        const malls = await mockListMalls();
        mallCtx = {
          activeId: current?.id ?? null,
          activeName: current?.name ?? '',
          malls: Array.isArray(malls) ? malls : [],
          source: 'mock',
        };
      } catch { /* mall resolution optional in fixture mode */ }
    }

    const ctx = {
      client,
      page: null,
      mallCtx,
      mallId: mallCtx?.activeId ?? null,
      authPath: resolvedAuthPath,
      account: accountCtx?.account ?? null,
      accountSlug: accountCtx?.slug ?? null,
      config: opts,
      log,
      correlation_id: correlationId,
      warnings,
      signal,
      deadlineAt,
    };

    try {
      const result = await run(ctx);
      const { data, meta: extraMeta, warnings: resultWarnings } = normalizeRunResult(result);
      const allWarnings = [...warnings, ...(resultWarnings ?? [])];

      const envelope = buildEnvelope({
        ok: true,
        command: name,
        data,
        meta: {
          latency_ms: Date.now() - startedAt,
          warnings: allWarnings,
          correlation_id: correlationId,
          exit_code: ExitCodes.OK,
          ...accountMetaForEnvelope(accountCtx),
          ...extraMeta,
        },
      });
      if (emitResult) emit(envelope, { json: opts.json, noColor: opts.noColor, renderer: render });
      return envelope;
    } catch (err) {
      const envelope = errorToEnvelope(name, err, {
        latency_ms: Date.now() - startedAt,
        warnings,
        correlation_id: correlationId,
      });
      if (emitResult) emit(envelope, { json: opts.json, noColor: opts.noColor });
      return envelope;
    }
  }

  return withBrowser({
    headed: opts.headed,
    storageStatePath: resolvedAuthPath,
  }, async ({ browser, context, page }) => {
    if (needsAuth) {
      throwIfAborted(signal);
      if (deadlineAt && remainingMs({ deadlineAt }) === 0) {
        throw timeoutError();
      }
      const authTimeoutMs = deadlineAt
        ? Math.max(1, Math.min(remainingMs({ deadlineAt }), 15000))
        : undefined;
      const valid = await isAuthValid(page, authTimeoutMs != null ? { timeoutMs: authTimeoutMs } : undefined);
      if (!valid) {
        throw new PddCliError({
          code: 'E_AUTH_EXPIRED',
          message: '登录态失效',
          hint: '执行 pdd login 重新登录',
          exitCode: ExitCodes.AUTH,
        });
      }

      if (!skipDaemonStart) {
        ensureDaemonRunning().catch((err) => {
          log.debug({ err: err?.message }, 'auto-start daemon failed (non-fatal)');
        });
      }
    }

    let mallCtx = null;
    if (needsMall === 'current' || needsMall === 'switch') {
      mallCtx = await resolveMallContext(page);
      if (needsMall === 'switch' && opts.mall) {
        await switchTo(page, opts.mall);
        mallCtx = await resolveMallContext(page);
      }
    }

    const pageSession = createPageSession(context);
    const client = getSharedClient();

    const ctx = {
      client,
      page,
      context,
      mallCtx,
      mallId: mallCtx?.activeId ?? null,
      authPath: resolvedAuthPath,
      account: accountCtx?.account ?? null,
      accountSlug: accountCtx?.slug ?? null,
      config: opts,
      log,
      correlation_id: correlationId,
      warnings,
      pageSession,
      signal,
      deadlineAt,
    };

    const result = await run(ctx);
    const { data, meta: extraMeta, warnings: resultWarnings } = normalizeRunResult(result);
    const allWarnings = [...warnings, ...(resultWarnings ?? [])];

    await pageSession.closeAll();

    const envelope = buildEnvelope({
      ok: true,
      command: name,
      data,
      meta: {
        latency_ms: Date.now() - startedAt,
        warnings: allWarnings,
        correlation_id: correlationId,
        exit_code: ExitCodes.OK,
        ...accountMetaForEnvelope(accountCtx),
        ...extraMeta,
      },
    });
    if (emitResult) emit(envelope, { json: opts.json, noColor: opts.noColor, renderer: render });
    return envelope;
  }).catch((err) => {
    const envelope = errorToEnvelope(name, err, {
      latency_ms: Date.now() - startedAt,
      warnings,
      correlation_id: correlationId,
    });
    if (emitResult) emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  });

  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}

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
  run,
  render,
}) {
  const spec = { name, needsAuth, needsMall, run, render };
  return function executeCommand(opts = {}) {
    if (opts.allAccounts && needsAuth) {
      return executeBatch(spec, opts);
    }
    return executeSingle(spec, opts, { emitResult: true, skipDaemonStart: false });
  };
}
