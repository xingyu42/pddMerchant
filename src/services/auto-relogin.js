import { attemptPasswordLogin } from '../adapter/password-login.js';
import { commitMerchantCandidate } from '../adapter/merchant-auth-storage.js';
import { assertAuthTask, assertMerchantVerified } from '../infra/auth-task.js';
import { renewLease } from '../infra/leases.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { decideRelogin, beginReloginAttempt, extractDeviceState } from './relogin-policy.js';

function configError(message) {
  return new PddCliError({
    code: 'E_CONFIG_INVALID',
    message,
    exitCode: ExitCodes.GENERAL,
  });
}

function validateRecoverDeps({ authPort, seal, commit, session, browserPort, passwordLogin }) {
  if (typeof authPort?.verifyAndSeal !== 'function') {
    throw configError('auto-relogin 需要有效的 AuthPort.verifyAndSeal');
  }
  if (typeof seal?.seal !== 'function' || typeof seal?.assert !== 'function') {
    throw configError('auto-relogin 需要有效的 CandidateSeal 实例');
  }
  if (typeof commit !== 'function') {
    throw configError('auto-relogin 需要有效的 commit 回调');
  }
  if (typeof passwordLogin !== 'function') {
    throw configError('auto-relogin 需要有效的 passwordLogin 适配器');
  }
  if (typeof session?.createSnapshotContext !== 'function' && typeof browserPort?.openSession !== 'function') {
    throw configError('auto-relogin 需要有效的 BrowserRuntimePort 或 BrowserSession');
  }
}

async function withReloginBudget(runtime, tx, clock, operation) {
  const nowFn = () => (clock?.now ? clock.now() : Date.now());
  runtime?.deadline?.pause?.();
  const controller = new AbortController();
  const task = {
    signal: runtime?.signal ? AbortSignal.any([runtime.signal, controller.signal]) : controller.signal,
    deadlineAt: nowFn() + TIMEOUTS.LOGIN_PASSWORD,
    ...(clock ? { clock } : {}),
  };
  const timer = setTimeout(
    () => controller.abort(new PddCliError({ code: 'E_AUTH_TIMEOUT', exitCode: ExitCodes.NETWORK })),
    TIMEOUTS.LOGIN_PASSWORD,
  );
  const previousSignal = tx.signal;
  const previousDeadlineAt = tx.deadlineAt;
  const previousClock = tx.clock;
  tx.signal = task.signal;
  tx.deadlineAt = task.deadlineAt;
  if (clock) tx.clock = clock;
  try {
    return await operation(task);
  } finally {
    clearTimeout(timer);
    runtime?.deadline?.resume?.();
    tx.signal = previousSignal;
    tx.deadlineAt = runtime?.deadline ? runtime.deadlineAt : previousDeadlineAt;
    tx.clock = previousClock;
  }
}

async function acquireContext({ session, browserPort, tx, ownerTag }) {
  const deviceState = extractDeviceState(tx);
  const once = (fn) => {
    let closing;
    return () => {
      closing ??= (async () => await fn())();
      return closing;
    };
  };
  if (typeof session?.createSnapshotContext === 'function') {
    const context = await session.createSnapshotContext(deviceState);
    return {
      context,
      ownedSession: null,
      createSnapshotContext: (_browser, snapshot) => session.createSnapshotContext(snapshot),
      closeResource: once(() => context.close()),
    };
  }
  const ownedSession = await browserPort.openSession({
    storageState: deviceState,
    ...(ownerTag ? { ownerTag } : {}),
  });
  return {
    context: ownedSession.context,
    ownedSession,
    createSnapshotContext: (_browser, snapshot) => ownedSession.createSnapshotContext(snapshot),
    closeResource: once(() => ownedSession.close()),
  };
}

function handleFailureOutcome(handle, result) {
  try {
    handle.fail(result);
  } catch (error) {
    if (error.code === 'E_AUTH_RELOGIN_FAILED' && result.verification?.reason === 'identity_mismatch') {
      assertMerchantVerified(result.verification);
    }
    throw error;
  }
}

async function runReloginAttempt({ tx, decision, seal, commit, clock, task, attempt }) {
  assertAuthTask(task);
  const handle = beginReloginAttempt(tx, { ...decision, seal, commit });
  let result;
  try {
    result = await attempt(decision.credential);
  } catch (error) {
    assertAuthTask(task);
    if (error instanceof PddCliError) throw error;
    result = { outcome: 'network_error' };
  }
  assertAuthTask(task);
  if (result.outcome !== 'success') handleFailureOutcome(handle, result);
  handle.succeed(result.candidate);
  renewLease('account', tx.accountId, tx.token, { clock });
}

async function executeLoginAndVerify({ tx, target, task, credential, authPort, seal, passwordLogin }) {
  const loginPage = target.ownedSession?.page ?? await target.context.newPage();
  const loginTask = {
    ...task,
    deadlineAt: task.deadlineAt - TIMEOUTS.LOGIN_PASSWORD_RESERVE,
    expectedMallId: tx.recoveryMallId,
  };
  const result = await passwordLogin(loginPage, credential, loginTask);
  assertAuthTask(task);
  if (result.outcome !== 'success') return result;
  await loginPage.close();
  const verified = await authPort.verifyAndSeal(target.context, {
    ...task,
    expectedMallId: tx.recoveryMallId,
    createSnapshotContext: target.createSnapshotContext,
    seal,
  });
  if (verified.verdict !== 'verified') return { outcome: 'verify_failed', verification: verified };
  return { ...result, candidate: verified.candidate };
}

async function runInReloginContext({
  tx,
  runtime,
  decision,
  session,
  authPort,
  browserPort,
  seal,
  commit,
  clock,
  passwordLogin,
  retainContext,
  task,
}) {
  let target = null;
  let retained = false;
  const onAbort = () => { void target?.closeResource().catch(() => {}); };
  task.signal.addEventListener('abort', onAbort, { once: true });
  try {
    await runReloginAttempt({
      tx,
      decision,
      seal,
      commit,
      clock,
      task,
      attempt: async (credential) => {
        target = await acquireContext({ session, browserPort, tx, ownerTag: runtime?.ownerTag });
        assertAuthTask(task);
        return executeLoginAndVerify({ tx, target, task, credential, authPort, seal, passwordLogin });
      },
    });
    if (!retainContext) return undefined;
    const page = await target.context.newPage();
    assertAuthTask(task);
    retained = true;
    return {
      context: target.context,
      page,
      ...(target.ownedSession ? { close: () => target.ownedSession.close() } : {}),
    };
  } finally {
    task.signal.removeEventListener('abort', onAbort);
    if (!retained && target) {
      try { await target.closeResource(); } catch { /* Preserve primary relogin outcome/error. */ }
    }
  }
}

/**
 * Single-entry online automatic relogin recovery shared by commands and patrol.
 * Preserves outer budget pause/resume, 90s child budget with 20s verify reserve,
 * Runtime Browser Profile inheritance, login-page close before independent check,
 * atomic candidate commit under lease + CAS, and cleanup of non-retained contexts.
 */
export async function recover({
  tx,
  runtime = {},
  authResult,
  session = null,
  authPort = runtime?.ports?.auth,
  browserPort = runtime?.ports?.browser,
  seal = runtime?.seal ?? tx?.seal,
  commit = commitMerchantCandidate,
  clock = runtime?.clock,
  passwordLogin = runtime?.passwordLogin ?? attemptPasswordLogin,
  retainContext = true,
} = {}) {
  const nowFn = () => (clock?.now ? clock.now() : Date.now());
  assertAuthTask(tx);
  assertAuthTask(runtime?.deadline ? { signal: runtime?.signal, clock } : { signal: runtime?.signal, deadlineAt: runtime?.deadlineAt, clock });
  validateRecoverDeps({ authPort, seal, commit, session, browserPort, passwordLogin });

  const decision = decideRelogin(tx.accountId, {
    now: nowFn(),
    minIntervalMs: runtime?.runtimeConfig?.passwordReloginMinIntervalMs,
    authResult,
  });
  if (decision.action === 'fail') throw decision.error;

  return withReloginBudget(runtime, tx, clock, (task) => runInReloginContext({
    tx, runtime, decision, session, authPort, browserPort, seal, commit, clock, passwordLogin, retainContext, task,
  }));
}
