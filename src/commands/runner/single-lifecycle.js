// 单命令生命周期（design D-2）：账号解析 → 超时-abort → fixture/live 分派 →
// live 浏览器流程（auth 校验、mall 解析/切换、pageSession）。
import { randomUUID } from 'node:crypto';
import { withBrowser } from '../../adapter/browser.js';
import { PDD_HOME } from '../../adapter/auth-state.js';
import { verifyMerchantContext, assertMerchantVerified } from '../../adapter/merchant-auth.js';
import { withMerchantAuthUpdate, commitMerchantCandidate, recordMerchantCheck, verifyStoredMerchant } from '../../adapter/merchant-auth-storage.js';
import { resolveMallContext } from '../../adapter/mall-reader.js';
import { switchTo } from '../../adapter/mall-writer.js';
import { isMockEnabled } from '../../adapter/mock-dispatcher.js';
import { getSharedClient } from '../../adapter/rate-limiter-singleton.js';
import { createPageSession } from '../../adapter/page-session.js';
import { getLogger } from '../../infra/logger.js';
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { resolveAccountContext } from '../../infra/account-resolver.js';
import { budgetMs, remainingMs, throwIfAborted, timeoutError } from '../../infra/abort.js';
import { reloginInCommand } from '../../services/password-relogin.js';
import { executeFixture, buildCommandCtx, appendActionWarnings } from './fixture-runtime.js';
import { finalizeSuccess, finalizeError } from './envelope-finalizer.js';

function anySignal(signals) {
  const filtered = signals.filter(Boolean);
  const noop = () => {};
  if (filtered.length === 0) return { signal: null, dispose: noop };
  if (filtered.length === 1) return { signal: filtered[0], dispose: noop };
  if (typeof AbortSignal.any === 'function') return { signal: AbortSignal.any(filtered), dispose: noop };
  const controller = new AbortController();
  const listeners = [];
  const dispose = () => {
    for (const [source, listener] of listeners) source.removeEventListener('abort', listener);
  };
  for (const s of filtered) {
    if (s.aborted) { controller.abort(s.reason); dispose(); break; }
    const listener = () => { controller.abort(s.reason); dispose(); };
    listeners.push([s, listener]);
    s.addEventListener('abort', listener, { once: true });
  }
  return { signal: controller.signal, dispose };
}

async function resolveAccount(opts, needsAuth, warnings) {
  return resolveAccountContext({
    account: opts.account,
    accountId: opts.accountId,
    needsAuth,
    warnings,
  });
}

export function armDeadline(opts, parentSignal, startedAt) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : null;
  const abortController = timeoutMs ? new AbortController() : null;
  let deadlineTimer = null;
  let deadlineAt = timeoutMs ? startedAt + timeoutMs : null;
  let remaining = null;
  const arm = () => { deadlineTimer = setTimeout(() => abortController.abort(), Math.max(0, deadlineAt - Date.now())); };
  if (timeoutMs) arm();
  const { signal, dispose } = anySignal([parentSignal, abortController?.signal]);
  return {
    signal,
    get deadlineAt() { return deadlineAt; },
    pause() {
      if (!timeoutMs || remaining !== null) return;
      throwIfAborted(signal);
      remaining = Math.max(0, deadlineAt - Date.now());
      if (remaining === 0) throw timeoutError();
      clearTimeout(deadlineTimer);
      deadlineAt = null;
    },
    resume() {
      if (!timeoutMs || remaining === null) return;
      deadlineAt = Date.now() + remaining;
      remaining = null;
      arm();
    },
    dispose() { clearTimeout(deadlineTimer); dispose(); },
  };
}

async function assertAuthValid(context, runtime, transaction) {
  const { signal, deadlineAt } = runtime;
  throwIfAborted(signal);
  if (deadlineAt && remainingMs({ deadlineAt }) === 0) {
    throw timeoutError();
  }
  const result = await verifyStoredMerchant(context, transaction.state, {
    signal, deadlineAt: deadlineAt ?? undefined, expectedMallId: runtime.accountCtx?.account?.identity,
  });
  if (result.verdict !== 'verified') await recordMerchantCheck(result, transaction);
  if (result.verdict === 'rejected') return result;
  assertMerchantVerified(result);
  runtime.verifiedMallId = result.identity.mallId;
  return result;
}

async function resolveLiveMall(needsMall, page, opts, runtimeConfig) {
  if (needsMall !== 'current' && needsMall !== 'switch') return null;
  let mallCtx = await resolveMallContext(page);
  if (needsMall === 'switch' && opts.mall) {
    await switchTo(page, opts.mall, { strict: runtimeConfig?.mallIdStrictParse });
    mallCtx = await resolveMallContext(page);
  }
  return mallCtx;
}

async function persistAuthStateAfterSuccess(spec, runtime, context, transaction, page) {
  if (!spec.needsAuth) return;
  if (runtime.selectedMallId != null && String(runtime.selectedMallId) !== runtime.verifiedMallId) {
    runtime.warnings.push('auth_state_identity_mismatch');
    return;
  }

  try {
    await page.close();
    const result = await verifyMerchantContext(context, {
      signal: runtime.signal, deadlineAt: runtime.deadlineAt ?? undefined, expectedMallId: runtime.verifiedMallId,
    });
    if (result.verdict !== 'verified') {
      runtime.warnings.push(result.reason === 'identity_mismatch' ? 'auth_state_identity_mismatch' : 'auth_state_persist_unverified');
      return;
    }
    await commitMerchantCandidate(result.candidate, transaction);
  } catch (err) {
    runtime.log.warn({ code: err?.code ?? null }, 'auth-state: persist after command failed');
    runtime.warnings.push(err?.code === 'E_AUTH_STATE_CONFLICT' ? 'auth_state_persist_conflict' : 'auth_state_persist_failed');
  }
}

async function executeLiveOperation(spec, runtime) {
  const { opts } = runtime;
  const operation = async (transaction) => withBrowser({
    headed: opts.headed,
    storageState: transaction?.state,
  }, async ({ browser, context: initialContext, page: initialPage }) => {
    let context = initialContext;
    let page = initialPage;
    if (spec.needsAuth) {
      const authResult = await assertAuthValid(context, runtime, transaction);
      if (authResult.verdict === 'rejected') {
        const replacement = await reloginInCommand(runtime, transaction, browser, authResult);
        await context.close();
        ({ context, page } = replacement);
        runtime.verifiedMallId = transaction.state.merchant_auth.mall_id;
      }
      await page.goto(PDD_HOME, { waitUntil: 'domcontentloaded', timeout: budgetMs(runtime, 60000) });
    }

    const mallCtx = await resolveLiveMall(spec.needsMall, page, opts, runtime.runtimeConfig);
    runtime.selectedMallId = mallCtx?.activeId ?? null;
    const pageSession = createPageSession(context);
    const ctx = buildCommandCtx(runtime, {
      client: getSharedClient(runtime.runtimeConfig),
      page,
      mallCtx,
      context,
      pageSession,
    });

    const result = await spec.run(ctx);

    // closeAll 留在成功 envelope 构造前（design D-2）：清理失败必须落错误 envelope，禁止 finally 化。
    // normalize/warnings 快照随 finalizeSuccess 移至 closeAll 之后（Phase-3 审查裁决）：
    // closeAll 逐页吞错且不持有 warnings 引用，顺序交换无可观察差异。
    await pageSession.closeAll();
    await persistAuthStateAfterSuccess(spec, runtime, context, transaction, page);

    appendActionWarnings(spec, runtime);
    return finalizeSuccess(spec, runtime, result);
  });
  return spec.needsAuth
    ? withMerchantAuthUpdate(runtime.accountCtx.accountId, operation, { signal: runtime.signal, deadlineAt: runtime.deadlineAt })
    : operation(null);
}

async function executeLive(spec, runtime) {
  try { return await executeLiveOperation(spec, runtime); }
  catch (err) {
    appendActionWarnings(spec, runtime);
    return finalizeError(spec, runtime, err);
  }
}

async function executeWithoutBrowser(spec, runtime) {
  try {
    const ctx = buildCommandCtx(runtime, { client: null, page: null, mallCtx: null });
    return finalizeSuccess(spec, runtime, await spec.run(ctx));
  } catch (error) { return finalizeError(spec, runtime, error); }
}

export async function executeSingle(spec, opts = {}, {
  emitResult = true,
  parentSignal,
  runtimeConfig,
} = {}) {
  const { name, needsAuth = true, needsMall = 'current', run, render } = spec;
  const normSpec = { name, needsAuth, needsMall, run, render };
  const startedAt = Date.now();
  const correlationId = opts._correlationId ?? randomUUID();
  const warnings = [];

  const log = getLogger().withOp
    ? getLogger().withOp({ command: name, correlation_id: correlationId })
    : getLogger();

  const accountCtx = spec.needsBrowser === false && !needsAuth ? null : await resolveAccount(opts, needsAuth, warnings);
  const deadline = armDeadline(opts, parentSignal ?? opts.signal, startedAt);

  const runtime = {
    opts,
    emitResult,
    startedAt,
    correlationId,
    warnings,
    log,
    accountCtx,
    signal: deadline.signal,
    get deadlineAt() { return deadline.deadlineAt; },
    deadline,
    runtimeConfig,
  };

  try {
    if (needsMall === 'none' && opts.mall) {
      log.warn({ mall: opts.mall }, 'command does not use --mall flag');
      warnings.push('unused_flag_mall');
    }

    // Both branches must settle before the deadline timer is disposed.
    if (spec.needsBrowser === false && !needsAuth) return await executeWithoutBrowser(normSpec, runtime);
    if (isMockEnabled()) return await executeFixture(normSpec, runtime);
    return await executeLive(normSpec, runtime);
  } finally {
    deadline.dispose();
  }
}
