import { withBrowser, closeBrowser } from '../adapter/browser.js';
import { assertMerchantVerified } from '../adapter/merchant-auth.js';
import { probeCheckLogin, selectCheckCookiesFromState } from '../adapter/merchant-auth-probe.js';
import { withMerchantAuthUpdate, verifyStoredMerchant, recordMerchantCheck, assertAuthTask } from '../adapter/merchant-auth-storage.js';
import { isMockEnabled, mockIsAuthValid, mockIsAuthIndeterminate } from '../adapter/mock-dispatcher.js';
import { listAccounts, getAccountById } from '../infra/account-store.js';
import { armDeadline, abortableSleep } from '../infra/abort.js';
import { setDaemonMeta } from '../infra/daemon-state.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { fixtureSessionRecovered, reloginForFixture, reloginInCommand } from './password-relogin.js';

const ACCOUNT_BUDGET_MS = 120_000;
const defaultClock = { now: () => Date.now(), sleep: abortableSleep };

export function patrolDelayMs(intervalMs, random = Math.random) {
  return Math.round(intervalMs * (0.8 + random() * 0.4));
}

export function patrolIntervalMs(runtimeConfig) {
  const override = isMockEnabled() ? Number(process.env.PDD_TEST_PATROL_INTERVAL_MS) : NaN;
  return Number.isSafeInteger(override) && override > 0 ? override : runtimeConfig.patrolIntervalMs;
}

async function checkFixture(account, runtime, tx) {
  if (mockIsAuthIndeterminate()) {
    throw new PddCliError({ code: 'E_AUTH_CHECK_INDETERMINATE', message: '无法确认登录状态', exitCode: ExitCodes.NETWORK });
  }
  if (!mockIsAuthValid() && !fixtureSessionRecovered(account.id)) {
    await reloginForFixture(account.id, runtime, { tx });
  }
}

async function checkLive(runtime, tx, ownerTag) {
  assertAuthTask(runtime);
  if (tx.state?.merchant_auth?.last_check?.verdict === 'rejected') return browserRelogin(runtime, tx, ownerTag);
  let result;
  try {
    const cookies = selectCheckCookiesFromState(tx.state);
    result = await probeCheckLogin(cookies, { signal: runtime.signal, deadlineAt: runtime.deadlineAt });
  } catch (error) {
    if (error?.code === 'E_AUTH_CANDIDATE_INVALID') return browserRelogin(runtime, tx, ownerTag);
    throw error;
  }
  assertAuthTask(runtime);
  if (result.verdict === 'verified') return;
  recordMerchantCheck(result, tx);
  if (result.verdict === 'rejected') return browserRelogin(runtime, tx, ownerTag);
  assertMerchantVerified(result);
}

async function browserRelogin(runtime, tx, ownerTag) {
  return withBrowser({ storageState: tx.state, ownerTag }, async ({ browser, context }) => {
    let closing;
    const onAbort = () => { closing = closeBrowser(browser).catch(() => {}); };
    runtime.signal.addEventListener('abort', onAbort, { once: true });
    try {
      assertAuthTask(runtime);
      const result = await verifyStoredMerchant(context, tx.state, {
        signal: runtime.signal, deadlineAt: runtime.deadlineAt, expectedMallId: tx.recoveryMallId,
      });
      assertAuthTask(runtime);
      if (result.verdict !== 'verified') recordMerchantCheck(result, tx);
      if (result.verdict === 'rejected') await reloginInCommand(runtime, tx, browser, result);
      else assertMerchantVerified(result);
      // No business result: keep the saved snapshot; relogin owns its verified commit.
    } finally {
      runtime.signal.removeEventListener('abort', onAbort);
      await closing;
    }
  });
}

async function checkAccount(account, context) {
  const deadline = armDeadline({ timeoutMs: ACCOUNT_BUDGET_MS }, context.signal, Date.now());
  const runtime = { deadline, signal: deadline.signal, runtimeConfig: context.runtimeConfig,
    get deadlineAt() { return deadline.deadlineAt; } };
  try {
    await withMerchantAuthUpdate(account.id, async (tx) => {
      if (getAccountById(account.id)?.disabled) return;
      if (isMockEnabled()) await checkFixture(account, runtime, tx);
      else await checkLive(runtime, tx, context.ownerTag);
      assertAuthTask(runtime);
    }, { timeoutMs: 0, signal: runtime.signal, deadlineAt: runtime.deadlineAt });
  } catch (error) {
    if (context.signal.aborted) return;
    const code = error instanceof PddCliError ? error.code : 'E_PATROL_ACCOUNT_FAILED';
    if (code === 'E_LOCK_TIMEOUT') context.log.info({ account: account.slug, code: 'patrol_account_busy' }, 'patrol: account occupied');
    else context.log.warn({ account: account.slug, code }, 'patrol: account check failed');
  } finally { deadline.dispose(); }
}

export async function runPatrolRound(context, clock = defaultClock) {
  for (const account of listAccounts({ kind: 'merchant' })) {
    if (context.signal.aborted) return;
    await checkAccount(account, context);
  }
  if (!context.signal.aborted) setDaemonMeta('daemon_last_patrol_at', new Date(clock.now()).toISOString());
}

async function patrolLoop(context, clock, random) {
  while (!context.signal.aborted) {
    try {
      await clock.sleep(patrolDelayMs(patrolIntervalMs(context.runtimeConfig), random), context.signal);
      if (!context.signal.aborted) await runPatrolRound(context, clock);
    } catch {
      if (!context.signal.aborted) context.log.warn({ code: 'E_PATROL_ROUND_FAILED' }, 'patrol: round failed');
    }
  }
}

export function createPatrol({ random = Math.random, clock = defaultClock } = {}) {
  let controller;
  let running;
  return {
    async start(context) {
      if (running || context.runtimeConfig?.patrolEnabled !== true) return;
      controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, context.signal].filter(Boolean));
      running = patrolLoop({ ...context, signal }, clock, random);
    },
    async stop() {
      controller?.abort();
      await running;
      running = null;
    },
  };
}
