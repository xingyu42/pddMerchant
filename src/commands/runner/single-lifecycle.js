// 单命令生命周期（design D-2）：账号解析 → 超时-abort → fixture/live 分派 →
// live 浏览器流程（auth 校验、mall 解析/切换、pageSession）。
import { randomUUID } from 'node:crypto';
import { PDD_HOME } from '../../adapter/auth-state.js';
import { withMerchantAuthUpdate, commitMerchantCandidate } from '../../adapter/merchant-auth-storage.js';
import { createPageSession } from '../../adapter/page-session.js';
import { getLogger } from '../../infra/logger.js';
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { resolveAccountContext } from '../../infra/account-resolver.js';
import { armDeadline, budgetMs, remainingMs, throwIfAborted, timeoutError } from '../../infra/abort.js';
import { composeCommandRuntime } from '../../runtime/command-runtime.js';
import { checkMerchantSession } from '../../services/merchant-session.js';
import { buildCommandCtx, appendActionWarnings } from './command-ctx.js';
import { finalizeSuccess, finalizeError } from './envelope-finalizer.js';
import {
  normalizeNeedsAccount,
  resolveCommandName,
  resolveEffectiveTimeoutMs,
  resolveNoColor,
} from './envelope-kernel.js';

export { armDeadline } from '../../infra/abort.js';

async function resolveAccount(opts, needsAuth, warnings, needsAccount = 'none') {
  const resolved = await resolveAccountContext({
    account: opts.account,
    accountId: opts.accountId,
    needsAuth,
    warnings,
  });
  if (needsAccount === 'required' && resolved.accountId == null) {
    throw new PddCliError({
      code: 'E_ACCOUNT_REQUIRED',
      message: '需要已登记的商家账号',
      hint: '使用 --account 选择账号，或执行 pdd login 登记账号',
      exitCode: ExitCodes.USAGE,
    });
  }
  return resolved;
}

async function assertAuthValid(context, runtime, transaction, session) {
  const { signal, deadlineAt, clock } = runtime;
  throwIfAborted(signal);
  if (deadlineAt && remainingMs({ deadlineAt, clock }) === 0) {
    throw timeoutError();
  }
  const verifyContext = runtime.ports?.auth?.verifyAndSeal;
  const sessionResult = await checkMerchantSession(context, {
    tx: transaction,
    runtime,
    session,
    task: {
      signal,
      deadlineAt: deadlineAt ?? undefined,
      clock,
      expectedMallId: runtime.accountCtx?.account?.identity,
      createSnapshotContext: (_browser, state) => session.createSnapshotContext(state),
      seal: runtime.seal,
      ...(typeof verifyContext === 'function' ? { verifyContext } : {}),
    },
  });
  runtime.verifiedMallId = sessionResult.mallId;
  return sessionResult;
}

async function resolveLiveMall(mallPort, needsMall, page, opts, runtimeConfig) {
  if (needsMall !== 'current' && needsMall !== 'switch') return null;
  let mallCtx = await mallPort.detectCurrentMall(page);
  if (needsMall === 'switch' && opts.mall) {
    await mallPort.switchMall(page, opts.mall, { strict: runtimeConfig?.mallIdStrictParse });
    mallCtx = await mallPort.detectCurrentMall(page);
  }
  return mallCtx;
}

async function persistAuthStateAfterSuccess(spec, runtime, context, transaction, page, session) {
  if (!spec.needsAuth) return;
  if (runtime.selectedMallId != null && String(runtime.selectedMallId) !== runtime.verifiedMallId) {
    runtime.warnings.push('auth_state_identity_mismatch');
    return;
  }

  try {
    await page.close();
    const verifyContext = runtime.ports?.auth?.verifyAndSeal;
    const result = await verifyContext(context, {
      signal: runtime.signal,
      deadlineAt: runtime.deadlineAt ?? undefined,
      clock: runtime.clock,
      expectedMallId: runtime.verifiedMallId,
      createSnapshotContext: (_browser, state) => session.createSnapshotContext(state),
      seal: runtime.seal,
    });
    if (result.verdict !== 'verified') {
      runtime.warnings.push(result.reason === 'identity_mismatch' ? 'auth_state_identity_mismatch' : 'auth_state_persist_unverified');
      return;
    }
    commitMerchantCandidate(result.candidate, transaction, { seal: runtime.seal });
  } catch (err) {
    runtime.log.warn({ code: err?.code ?? null }, 'auth-state: persist after command failed');
    runtime.warnings.push(err?.code === 'E_AUTH_STATE_CONFLICT' ? 'auth_state_persist_conflict' : 'auth_state_persist_failed');
  }
}

async function executeLiveOperation(spec, runtime) {
  const { opts, ports } = runtime;
  const operation = async (transaction) => ports.browser.withSession({
    headed: opts.headed,
    storageState: transaction?.state,
  }, async (session) => {
    let { context, page } = session;
    if (spec.needsAuth) {
      const { replacement } = await assertAuthValid(context, runtime, transaction, session);
      if (replacement) {
        await context.close();
        ({ context, page } = replacement);
      }
      await page.goto(PDD_HOME, { waitUntil: 'domcontentloaded', timeout: budgetMs(runtime, 60000) });
    }

    const mallCtx = await resolveLiveMall(ports.mall, spec.needsMall, page, opts, runtime.runtimeConfig);
    runtime.selectedMallId = mallCtx?.activeId ?? null;
    const pageSession = createPageSession(context, { now: runtime.clock?.now });
    const ctx = buildCommandCtx(runtime, {
      client: ports.endpoint,
      page,
      mallCtx,
      context,
      browserSession: session,
      pageSession,
    });

    const result = await spec.run(ctx);

    // closeAll 留在成功 envelope 构造前（design D-2）：清理失败必须落错误 envelope，禁止 finally 化。
    await pageSession.closeAll();
    await persistAuthStateAfterSuccess(spec, runtime, context, transaction, page, session);

    appendActionWarnings(spec, runtime);
    return finalizeSuccess(spec, runtime, result);
  });
  return spec.needsAuth
    ? withMerchantAuthUpdate(runtime.accountCtx.accountId, operation, {
      signal: runtime.signal,
      deadlineAt: runtime.deadlineAt,
      seal: runtime.seal,
      clock: runtime.clock,
    })
    : operation(null);
}

async function executeLive(spec, runtime) {
  try {
    return await executeLiveOperation(spec, runtime);
  } catch (err) {
    appendActionWarnings(spec, runtime);
    return finalizeError(spec, runtime, err);
  }
}

async function executeWithoutBrowser(spec, runtime) {
  try {
    throwIfAborted(runtime.signal);
    const ctx = buildCommandCtx(runtime, { client: null, page: null, mallCtx: null });
    return finalizeSuccess(spec, runtime, await spec.run(ctx));
  } catch (error) {
    return finalizeError(spec, runtime, error);
  }
}

function normalizeSingleSpec(spec, opts) {
  const commandName = resolveCommandName(spec, opts);
  const needsAuth = spec.needsAuth ?? true;
  const needsMall = spec.needsMall ?? 'current';
  const needsAccount = normalizeNeedsAccount(spec.needsAccount)
    ?? (needsAuth ? 'required' : (spec.needsBrowser === false ? 'none' : 'optional'));
  return {
    ...spec,
    name: commandName,
    command: spec.command ?? commandName,
    needsAuth,
    needsMall,
    needsAccount,
  };
}

function buildOwnedRuntimeState({ normSpec, opts, composedRuntime, parentSignal }) {
  const clock = composedRuntime.clock;
  const startedAt = clock.now();
  const correlationId = opts._correlationId ?? composedRuntime.correlationId ?? randomUUID();
  const log = getLogger().withOp
    ? getLogger().withOp({ command: normSpec.name, correlation_id: correlationId })
    : getLogger();
  const effectiveTimeoutMs = resolveEffectiveTimeoutMs(normSpec, opts);
  const resolvedOpts = {
    ...opts,
    noColor: resolveNoColor(opts),
    ...(effectiveTimeoutMs !== undefined ? { timeoutMs: effectiveTimeoutMs } : {}),
  };
  const deadline = armDeadline(resolvedOpts, parentSignal ?? composedRuntime.signal ?? resolvedOpts.signal, startedAt, clock);
  return { startedAt, correlationId, warnings: [], log, opts: resolvedOpts, deadline };
}

function chainDeadline(accountDeadline, parentDeadline) {
  if (!parentDeadline) return accountDeadline;
  return {
    get signal() { return accountDeadline.signal; },
    get deadlineAt() { return accountDeadline.deadlineAt; },
    pause() {
      parentDeadline.pause();
      try {
        accountDeadline.pause();
      } catch (err) {
        parentDeadline.resume();
        throw err;
      }
    },
    resume() {
      accountDeadline.resume();
      parentDeadline.resume();
    },
    dispose() {
      accountDeadline.dispose();
    },
  };
}

function prepareSingleState({ normSpec, opts, composedRuntime, parentSignal, parentDeadline, runtimeConfig, endpointState, emitResult }) {
  const ownsDeadline = !composedRuntime.deadline;
  const owned = ownsDeadline
    ? buildOwnedRuntimeState({ normSpec, opts, composedRuntime, parentSignal })
    : {
        startedAt: composedRuntime.startedAt,
        correlationId: composedRuntime.correlationId,
        warnings: composedRuntime.warnings,
        log: composedRuntime.log,
        opts: composedRuntime.opts ?? opts,
        deadline: composedRuntime.deadline,
      };
  const deadline = ownsDeadline && parentDeadline
    ? chainDeadline(owned.deadline, parentDeadline)
    : owned.deadline;
  const runtime = {
    ...composedRuntime,
    ...owned,
    deadline,
    emitResult,
    accountCtx: null,
    signal: deadline.signal,
    get deadlineAt() { return deadline.deadlineAt; },
    runtimeConfig: runtimeConfig ?? composedRuntime.runtimeConfig,
    endpointState: endpointState ?? composedRuntime.endpointState,
  };
  return { ownsDeadline, runtime };
}

export async function executeSingle(spec, opts = {}, {
  emitResult = true,
  parentSignal,
  parentDeadline = null,
  runtimeConfig,
  endpointState = null,
  runtime: providedRuntime = null,
} = {}) {
  const selfComposed = !providedRuntime;
  const composedRuntime = providedRuntime ?? await composeCommandRuntime({
    env: process.env,
    runtimeConfigPolicy: spec.runtimeConfigPolicy ?? 'maintenance',
    overrides: {
      ...(runtimeConfig !== undefined ? { runtimeConfig } : {}),
      ...(endpointState ? { endpointState } : {}),
    },
  });
  const normSpec = normalizeSingleSpec(spec, opts);
  const { ownsDeadline, runtime } = prepareSingleState({
    normSpec, opts, composedRuntime, parentSignal, parentDeadline, runtimeConfig, endpointState, emitResult,
  });

  try {
    const skipAccount = normSpec.lifecycle === 'maintenance'
      || (normSpec.needsBrowser === false && !normSpec.needsAuth && normSpec.needsAccount === 'none');
    try {
      runtime.accountCtx = skipAccount
        ? null
        : await resolveAccount(runtime.opts, normSpec.needsAuth, runtime.warnings, normSpec.needsAccount);
    } catch (err) {
      if (emitResult) return finalizeError(normSpec, runtime, err);
      throw err;
    }

    if (normSpec.needsMall === 'none' && runtime.opts.mall) {
      runtime.log.warn({ mall: runtime.opts.mall }, 'command does not use --mall flag');
      runtime.warnings.push('unused_flag_mall');
    }

    // Both branches must settle before the deadline timer is disposed.
    if (normSpec.needsBrowser === false && !normSpec.needsAuth) return await executeWithoutBrowser(normSpec, runtime);
    if (runtime.mode === 'fixture') {
      const { executeFixture } = await import('./fixture-runtime.js');
      return await executeFixture(normSpec, runtime);
    }
    return await executeLive(normSpec, runtime);
  } finally {
    if (ownsDeadline) runtime.deadline?.dispose();
    if (selfComposed) await composedRuntime.closeAll();
  }
}
