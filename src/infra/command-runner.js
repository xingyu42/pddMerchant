import { randomUUID } from 'node:crypto';
import { withBrowser } from '../adapter/browser.js';
import { isAuthValid, loadAuthState, migrateLegacyAuthStateIfNeeded } from '../adapter/auth-state.js';
import { currentMall, resolveMallContext } from '../adapter/mall-reader.js';
import { switchTo } from '../adapter/mall-writer.js';
import { FixtureEndpointClient, mockCurrentMall, mockListMalls } from '../adapter/mock-dispatcher.js';
import { getSharedClient } from '../adapter/rate-limiter-singleton.js';
import { createPageSession } from '../adapter/page-session.js';
import { createLogger, getLogger } from '../infra/logger.js';
import { emit, buildEnvelope } from '../infra/output.js';
import { PddCliError, ExitCodes, errorToEnvelope } from '../infra/errors.js';
import { AUTH_STATE_PATH } from '../infra/paths.js';
import { isMockEnabled } from '../adapter/mock-dispatcher.js';
import { remainingMs, throwIfAborted, timeoutError } from '../infra/abort.js';
import { ensureDaemonRunning } from '../infra/daemon-launcher.js';

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

export function withCommand({
  name,
  needsAuth = true,
  needsMall = 'current',
  run,
  render,
}) {
  return async function executeCommand(opts = {}) {
    const startedAt = Date.now();
    const correlationId = randomUUID();
    const warnings = [];

    const log = getLogger().withOp
      ? getLogger().withOp({ command: name, correlation_id: correlationId })
      : getLogger();

    const authPath = opts.authStatePath ?? AUTH_STATE_PATH;

    // --- Timeout / AbortController (W1) ---
    let abortController = null;
    let deadlineTimer = null;
    if (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0) {
      abortController = new AbortController();
      deadlineTimer = setTimeout(() => abortController.abort(), opts.timeoutMs);
    }
    const signal = abortController?.signal ?? null;
    const deadlineAt = signal ? startedAt + opts.timeoutMs : null;

    try {

    await migrateLegacyAuthStateIfNeeded(authPath, warnings).catch((err) => {
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
        emit(envelope, { json: opts.json, noColor: opts.noColor });
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
        authPath,
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
            ...extraMeta,
          },
        });
        emit(envelope, { json: opts.json, noColor: opts.noColor, renderer: render });
        return envelope;
      } catch (err) {
        const envelope = errorToEnvelope(name, err, {
          latency_ms: Date.now() - startedAt,
          warnings,
          correlation_id: correlationId,
        });
        emit(envelope, { json: opts.json, noColor: opts.noColor });
        return envelope;
      }
    }

    return withBrowser({
      headed: opts.headed,
      storageStatePath: authPath,
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

        ensureDaemonRunning().catch((err) => {
          log.debug({ err: err?.message }, 'auto-start daemon failed (non-fatal)');
        });
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
        authPath,
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
          ...extraMeta,
        },
      });
      emit(envelope, { json: opts.json, noColor: opts.noColor, renderer: render });
      return envelope;
    }).catch((err) => {
      const envelope = errorToEnvelope(name, err, {
        latency_ms: Date.now() - startedAt,
        warnings,
        correlation_id: correlationId,
      });
      emit(envelope, { json: opts.json, noColor: opts.noColor });
      return envelope;
    });

    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
    }
  };
}
