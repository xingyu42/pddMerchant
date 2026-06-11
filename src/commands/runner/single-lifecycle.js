// 单命令生命周期（design D-2）：账号解析 → 超时-abort → fixture/live 分派 →
// live 浏览器流程（auth 校验、daemon 自启、mall 解析/切换、pageSession）。
import { randomUUID } from 'node:crypto';
import { withBrowser } from '../../adapter/browser.js';
import { isAuthValid, migrateLegacyAuthStateIfNeeded } from '../../adapter/auth-state.js';
import { resolveMallContext } from '../../adapter/mall-reader.js';
import { switchTo } from '../../adapter/mall-writer.js';
import { isMockEnabled } from '../../adapter/mock-dispatcher.js';
import { getSharedClient } from '../../adapter/rate-limiter-singleton.js';
import { createPageSession } from '../../adapter/page-session.js';
import { getLogger } from '../../infra/logger.js';
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { AUTH_STATE_PATH } from '../../infra/paths.js';
import { resolveAccountContext } from '../../infra/account-resolver.js';
import { remainingMs, throwIfAborted, timeoutError } from '../../infra/abort.js';
import { ensureDaemonRunning } from '../../infra/daemon-launcher.js';
import { executeFixture, buildCommandCtx } from './fixture-runtime.js';
import { finalizeSuccess, finalizeError } from './envelope-finalizer.js';

function anySignal(signals) {
  const filtered = signals.filter(Boolean);
  if (filtered.length === 0) return null;
  if (filtered.length === 1) return filtered[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(filtered);
  const controller = new AbortController();
  for (const s of filtered) {
    if (s.aborted) { controller.abort(s.reason); return controller.signal; }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

async function resolveAccount(opts, needsAuth, warnings, log) {
  try {
    return await resolveAccountContext({
      account: opts.account,
      authStatePath: opts.authStatePath,
      needsAuth,
      warnings,
    });
  } catch (resolveErr) {
    if (resolveErr instanceof PddCliError) throw resolveErr;
    log.debug({ err: resolveErr?.message }, 'account resolution failed, falling back');
    return null;
  }
}

function armDeadline(opts, parentSignal, startedAt) {
  let abortController = null;
  let deadlineTimer = null;
  if (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0) {
    abortController = new AbortController();
    deadlineTimer = setTimeout(() => abortController.abort(), opts.timeoutMs);
  }
  const signal = anySignal([parentSignal, abortController?.signal]);
  return {
    signal,
    deadlineTimer,
    deadlineAt: signal ? startedAt + (opts.timeoutMs ?? Infinity) : null,
  };
}

async function assertAuthValid(page, { signal, deadlineAt }) {
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
}

async function resolveLiveMall(needsMall, page, opts) {
  if (needsMall !== 'current' && needsMall !== 'switch') return null;
  let mallCtx = await resolveMallContext(page);
  if (needsMall === 'switch' && opts.mall) {
    await switchTo(page, opts.mall);
    mallCtx = await resolveMallContext(page);
  }
  return mallCtx;
}

// 非 async 包装：promise 在创建时即返回调用方（executeSingle 的 finally 随之执行），
// 与拆分前 `return withBrowser(...)` 的 deadlineTimer 清理时序逐字一致。
function executeLive(spec, runtime) {
  const { opts, log } = runtime;
  return withBrowser({
    headed: opts.headed,
    storageStatePath: runtime.authPath,
  }, async ({ context, page }) => {
    if (spec.needsAuth) {
      await assertAuthValid(page, runtime);
      if (!runtime.skipDaemonStart) {
        ensureDaemonRunning().catch((err) => {
          log.debug({ err: err?.message }, 'auto-start daemon failed (non-fatal)');
        });
      }
    }

    const mallCtx = await resolveLiveMall(spec.needsMall, page, opts);
    const pageSession = createPageSession(context);
    const ctx = buildCommandCtx(runtime, {
      client: getSharedClient(),
      page,
      mallCtx,
      context,
      pageSession,
    });

    const result = await spec.run(ctx);

    // closeAll 留在成功 envelope 构造前（design D-2）：清理失败必须落错误 envelope，禁止 finally 化
    await pageSession.closeAll();

    return finalizeSuccess(spec, runtime, result);
  }).catch((err) => finalizeError(spec, runtime, err));
}

export async function executeSingle(spec, opts = {}, { emitResult = true, skipDaemonStart = false, parentSignal } = {}) {
  const { name, needsAuth = true, needsMall = 'current', run, render } = spec;
  const normSpec = { name, needsAuth, needsMall, run, render };
  const startedAt = Date.now();
  const correlationId = opts._correlationId ?? randomUUID();
  const warnings = [];

  const log = getLogger().withOp
    ? getLogger().withOp({ command: name, correlation_id: correlationId })
    : getLogger();

  const accountCtx = await resolveAccount(opts, needsAuth, warnings, log);
  const { signal, deadlineTimer, deadlineAt } = armDeadline(opts, parentSignal, startedAt);

  const runtime = {
    opts,
    emitResult,
    skipDaemonStart,
    startedAt,
    correlationId,
    warnings,
    log,
    authPath: accountCtx?.authPath ?? opts.authStatePath ?? AUTH_STATE_PATH,
    accountCtx,
    signal,
    deadlineAt,
  };

  try {
    await migrateLegacyAuthStateIfNeeded(runtime.authPath, warnings).catch((err) => {
      log.debug({ err: err?.message }, 'legacy auth migration check failed');
    });

    if (needsMall === 'none' && opts.mall) {
      log.warn({ mall: opts.mall }, 'command does not use --mall flag');
      warnings.push('unused_flag_mall');
    }

    // fixture 在 try 内完整 await（deadlineTimer 全程武装）；live 维持不 await 的原时序
    if (isMockEnabled()) return await executeFixture(normSpec, runtime);
    return executeLive(normSpec, runtime);
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}
