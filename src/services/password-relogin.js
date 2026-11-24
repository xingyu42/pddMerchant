import { assertMerchantVerified, assertVerifiedMerchantCandidate, verifyMerchantContext } from '../adapter/merchant-auth.js';
import { createSnapshotContext } from '../adapter/browser.js';
import { attemptPasswordLogin } from '../adapter/password-login.js';
import { loadAuthState } from '../adapter/auth-state.js';
import { withMerchantAuthUpdate, commitMerchantCandidate } from '../adapter/merchant-auth-storage.js';
import { assertAuthTask } from '../infra/auth-task.js';
import { renewLease } from '../infra/leases.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { decideRelogin, beginReloginAttempt, extractDeviceState } from './relogin-policy.js';

function hasReloginMarker(state) {
  return state?.cookies?.some((cookie) => cookie.name === 'PDD_FIXTURE_RELOGIN' && cookie.value === '1') ?? false;
}

export function fixtureSessionRecovered(accountId) {
  return hasReloginMarker(loadAuthState(accountId).state);
}

async function withReloginBudget(runtime, tx, operation) {
  const nowFn = () => (runtime?.clock?.now ? runtime.clock.now() : Date.now());
  runtime.deadline.pause();
  const controller = new AbortController();
  const task = {
    signal: runtime.signal ? AbortSignal.any([runtime.signal, controller.signal]) : controller.signal,
    deadlineAt: nowFn() + TIMEOUTS.LOGIN_PASSWORD,
  };
  const timer = setTimeout(() => controller.abort(new PddCliError({ code: 'E_AUTH_TIMEOUT', exitCode: ExitCodes.NETWORK })), TIMEOUTS.LOGIN_PASSWORD);
  const previousSignal = tx.signal;
  tx.signal = task.signal;
  tx.deadlineAt = task.deadlineAt;
  try {
    return await operation(task);
  } finally {
    clearTimeout(timer);
    runtime.deadline.resume();
    tx.signal = previousSignal;
    tx.deadlineAt = runtime.deadlineAt;
  }
}

function beginRelogin(tx, runtime, authResult) {
  assertAuthTask(tx);
  const decision = decideRelogin(tx.accountId, {
    minIntervalMs: runtime.runtimeConfig?.passwordReloginMinIntervalMs,
    authResult,
  });
  if (decision.action === 'fail') throw decision.error;
  return decision;
}

async function runRelogin(runtime, tx, decision, task, attempt) {
  assertAuthTask(task);
  const seal = runtime?.seal ?? tx?.seal ?? {
    assert: (candidate) => assertVerifiedMerchantCandidate(candidate),
  };
  const handle = beginReloginAttempt(tx, {
    ...decision,
    seal,
    commit: commitMerchantCandidate,
  });
  let result;
  try {
    result = await attempt(decision.credential);
  } catch (error) {
    assertAuthTask(task);
    if (error instanceof PddCliError) throw error;
    result = { outcome: 'network_error' };
  }
  assertAuthTask(task);
  if (result.outcome !== 'success') {
    try {
      handle.fail(result);
    } catch (error) {
      if (error.code === 'E_AUTH_RELOGIN_FAILED' && result.verification?.reason === 'identity_mismatch') {
        assertMerchantVerified(result.verification);
      }
      throw error;
    }
  }
  handle.succeed(result.candidate);
  renewLease('account', tx.accountId, tx.token);
}

export async function reloginInCommand(runtime, tx, browserOrSession, authResult) {
  const decision = beginRelogin(tx, runtime, authResult);
  return withReloginBudget(runtime, tx, async (task) => {
    let context;
    let retained = false;
    const onAbort = () => { void context?.close().catch(() => {}); };
    task.signal.addEventListener('abort', onAbort, { once: true });
    try {
      await runRelogin(runtime, tx, decision, task, async (credential) => {
        const hasSessionSnapshot = typeof browserOrSession?.createSnapshotContext === 'function';
        const createSnapshotFn = hasSessionSnapshot
          ? (_browser, state) => browserOrSession.createSnapshotContext(state)
          : createSnapshotContext;
        context = await (hasSessionSnapshot
          ? browserOrSession.createSnapshotContext(extractDeviceState(tx))
          : createSnapshotContext(browserOrSession, extractDeviceState(tx)));
        assertAuthTask(task);
        const loginPage = await context.newPage();
        const loginTask = { ...task, deadlineAt: task.deadlineAt - TIMEOUTS.LOGIN_PASSWORD_RESERVE };
        const result = await attemptPasswordLogin(loginPage, credential, loginTask);
        assertAuthTask(task);
        if (result.outcome !== 'success') return result;
        await loginPage.close();
        const verifyContext = runtime?.ports?.auth?.verifyAndSeal ?? verifyMerchantContext;
        const verified = await verifyContext(context, {
          ...task,
          expectedMallId: tx.recoveryMallId,
          createSnapshotContext: createSnapshotFn,
          seal: runtime?.seal,
        });
        if (verified.verdict !== 'verified') return { outcome: 'verify_failed', verification: verified };
        return { ...result, candidate: verified.candidate };
      });
      const page = await context.newPage();
      assertAuthTask(task);
      retained = true;
      return { context, page };
    } finally {
      task.signal.removeEventListener('abort', onAbort);
      if (!retained && context) {
        try { await context.close(); } catch { /* 保留原重登错误。 */ }
      }
    }
  });
}

export async function reloginForFixture(accountId, runtime, { tx: heldTransaction } = {}) {
  const operation = async (tx) => {
    if (hasReloginMarker(tx.state)) return;
    const decision = beginRelogin(tx, runtime);
    return withReloginBudget(runtime, tx, (task) => runRelogin(runtime, tx, decision, task, async () => {
      const fixtureHelpers = runtime?.fixture ?? await import('../adapter/fixtures/auth.js');
      const result = runtime?.fixture
        ? await fixtureHelpers.mockPasswordLogin(task)
        : await fixtureHelpers.mockPasswordLogin(task, runtime?.env);
      if (result.outcome !== 'success') return result;
      const context = fixtureHelpers.createFixtureReloginContext(tx.recoveryMallId);
      let verified;
      if (runtime?.ports?.auth?.verifyAndSeal) {
        verified = await runtime.ports.auth.verifyAndSeal(context, {
          ...task,
          expectedMallId: tx.recoveryMallId,
          seal: runtime?.seal,
        });
      } else {
        const verify = fixtureHelpers.verifyFixtureMerchantContext
          ?? (await import('../adapter/fixtures/auth.js')).verifyFixtureMerchantContext;
        verified = await verify(context, {
          ...task,
          expectedMallId: tx.recoveryMallId,
          seal: runtime?.seal,
        });
      }
      if (verified.verdict !== 'verified') return { outcome: 'verify_failed', verification: verified };
      return { ...result, candidate: verified.candidate };
    }));
  };
  if (heldTransaction) return operation(heldTransaction);
  return withMerchantAuthUpdate(accountId, operation, {
    signal: runtime.signal,
    deadlineAt: runtime.deadlineAt,
    seal: runtime?.seal,
  });
}
