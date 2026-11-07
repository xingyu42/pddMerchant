import { withBrowser, closeBrowser } from '../adapter/browser.js';
import { withMerchantAuthUpdate, assertAuthTask } from '../adapter/merchant-auth-storage.js';
import { isMockEnabled } from '../adapter/mock-dispatcher.js';
import { listAccounts } from '../infra/account-store.js';
import { armDeadline, abortableSleep } from '../infra/abort.js';
import { setDaemonMeta } from '../infra/daemon-state.js';
import { PddCliError } from '../infra/errors.js';
import { checkMerchantSession, probeMerchantSession, checkFixtureMerchantSession } from './merchant-session.js';

const ACCOUNT_BUDGET_MS = 120_000;
const defaultClock = { now: () => Date.now(), sleep: abortableSleep };

export function patrolDelayMs(intervalMs, random = Math.random) {
  return Math.round(intervalMs * (0.8 + random() * 0.4));
}

export function patrolIntervalMs(runtimeConfig) {
  const override = isMockEnabled() ? Number(process.env.PDD_TEST_PATROL_INTERVAL_MS) : NaN;
  return Number.isSafeInteger(override) && override > 0 ? override : runtimeConfig.patrolIntervalMs;
}

async function checkLive(runtime, tx, ownerTag) {
  if (!await probeMerchantSession(tx, runtime)) await browserRelogin(runtime, tx, ownerTag);
}

async function browserRelogin(runtime, tx, ownerTag) {
  return withBrowser({ storageState: tx.state, ownerTag }, async ({ browser, context }) => {
    let closing;
    const onAbort = () => { closing = closeBrowser(browser).catch(() => {}); };
    runtime.signal.addEventListener('abort', onAbort, { once: true });
    try {
      assertAuthTask(runtime);
      await checkMerchantSession(context, { tx, runtime, browser, mode: 'patrol',
        task: { signal: runtime.signal, deadlineAt: runtime.deadlineAt, expectedMallId: tx.recoveryMallId },
      });
      assertAuthTask(runtime);
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
      if (isMockEnabled()) await checkFixtureMerchantSession(account.id, runtime, { tx });
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

// persist 先落盘再切换运行态；落盘失败时运行态保持原样。
export function createPatrol({ random = Math.random, clock = defaultClock, persist = async () => {} } = {}) {
  let context;
  let controller;
  let running;
  let stopped = false;
  let switching = Promise.resolve();
  const begin = () => {
    if (running || stopped || !context) return;
    controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, context.signal].filter(Boolean));
    running = patrolLoop({ ...context, signal }, clock, random);
  };
  const halt = async () => {
    controller?.abort();
    await running;
    running = null;
  };
  return {
    async start(nextContext) {
      context = nextContext;
      if (nextContext.runtimeConfig?.patrolEnabled === true) begin();
    },
    setEnabled(enabled) {
      switching = switching.catch(() => {}).then(async () => {
        await persist(enabled);
        if (enabled) begin();
        else await halt();
      });
      return switching;
    },
    isEnabled: () => Boolean(running),
    async stop() {
      stopped = true;
      await switching.catch(() => {});
      await halt();
    },
  };
}
