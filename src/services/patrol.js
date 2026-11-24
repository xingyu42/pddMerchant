import { withMerchantAuthUpdate } from '../adapter/merchant-auth-storage.js';
import { assertAuthTask } from '../infra/auth-task.js';
import { listAccounts } from '../infra/account-store.js';
import { armDeadline, abortableSleep } from '../infra/abort.js';
import { setDaemonMeta } from '../infra/daemon-state.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { checkMerchantSession, probeMerchantSession } from './merchant-session.js';

const ACCOUNT_BUDGET_MS = 120_000;
const defaultClock = { now: () => Date.now(), sleep: abortableSleep };

export function patrolDelayMs(intervalMs, random = Math.random) {
  return Math.round(intervalMs * (0.8 + random() * 0.4));
}

export function patrolIntervalMs(runtimeConfig, runtime) {
  const override = runtime?.mode === 'fixture' ? runtime?.env?.patrolIntervalMs : null;
  return Number.isSafeInteger(override) && override > 0 ? override : runtimeConfig.patrolIntervalMs;
}

async function browserRelogin(runtime, tx, ownerTag) {
  const browserPort = runtime.ports?.browser;
  if (!browserPort || typeof browserPort.withSession !== 'function') {
    throw new PddCliError({
      code: 'E_CONFIG_INVALID',
      message: 'patrol 需要有效的 BrowserRuntimePort',
      exitCode: ExitCodes.GENERAL,
    });
  }
  return browserPort.withSession({ storageState: tx.state, ownerTag }, async (session) => {
    let closing;
    const onAbort = () => { closing = session.close().catch(() => {}); };
    runtime.signal.addEventListener('abort', onAbort, { once: true });
    try {
      assertAuthTask(runtime);
      await checkMerchantSession(session.context, {
        tx,
        runtime,
        session,
        mode: 'patrol',
        task: {
          signal: runtime.signal,
          deadlineAt: runtime.deadlineAt,
          clock: runtime.clock,
          expectedMallId: tx.recoveryMallId,
          createSnapshotContext: (_browser, state) => session.createSnapshotContext(state),
          seal: runtime.seal,
          ...(typeof runtime.ports?.auth?.verifyAndSeal === 'function'
            ? { verifyContext: runtime.ports.auth.verifyAndSeal }
            : {}),
        },
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
  const activeClock = context.clock ?? context.runtime?.clock ?? defaultClock;
  const deadline = armDeadline({ timeoutMs: ACCOUNT_BUDGET_MS }, context.signal, activeClock.now(), activeClock);
  const runtime = {
    deadline,
    signal: deadline.signal,
    runtimeConfig: context.runtimeConfig,
    clock: activeClock,
    ownerTag: context.ownerTag,
    env: context.runtime?.env,
    fixture: context.runtime?.fixture,
    ports: context.runtime?.ports,
    seal: context.runtime?.seal,
    passwordLogin: context.runtime?.passwordLogin,
    mode: context.runtime?.mode,
    get deadlineAt() { return deadline.deadlineAt; },
  };
  try {
    await withMerchantAuthUpdate(account.id, async (tx) => {
      if (!await probeMerchantSession(tx, runtime)) await browserRelogin(runtime, tx, context.ownerTag);
      assertAuthTask(runtime);
    }, { timeoutMs: 0, signal: runtime.signal, deadlineAt: runtime.deadlineAt, clock: activeClock, seal: runtime.seal });
  } catch (error) {
    if (context.signal.aborted) return;
    const code = error instanceof PddCliError ? error.code : 'E_PATROL_ACCOUNT_FAILED';
    if (code === 'E_LOCK_TIMEOUT') context.log.info({ account: account.slug, code: 'patrol_account_busy' }, 'patrol: account occupied');
    else context.log.warn({ account: account.slug, code }, 'patrol: account check failed');
  } finally {
    deadline.dispose();
  }
}

export async function runPatrolRound(context, clock = context.clock ?? defaultClock) {
  for (const account of listAccounts({ kind: 'merchant' })) {
    if (context.signal.aborted) return;
    await checkAccount(account, { ...context, clock });
  }
  if (!context.signal.aborted) setDaemonMeta('daemon_last_patrol_at', new Date(clock.now()).toISOString());
}

async function patrolLoop(context, clock, random) {
  while (!context.signal.aborted) {
    try {
      await clock.sleep(patrolDelayMs(patrolIntervalMs(context.runtimeConfig, context.runtime), random), context.signal);
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
    const activeClock = context.clock ?? clock;
    controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, context.signal].filter(Boolean));
    running = patrolLoop({ ...context, signal }, activeClock, random);
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
