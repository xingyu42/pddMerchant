import { resolveClock } from '../infra/clock.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { createFixtureReloginContext, mockPasswordLogin } from './fixtures/auth.js';
import { createDeterministicTakeoverChannel, invalidTakeoverInput } from './takeover.js';
import {
  combineAbortSignals,
  createDriverSessionHandle,
  validateDriverDependencies,
  validateDriverOpenParams,
} from './console-login-driver-shared.js';
import { assertAuthTask } from '../infra/auth-task.js';

export const FIXTURE_QR_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVR4nGP4+vUrAAXCAuCuRnaIAAAAAElFTkSuQmCC';
const JPEG = [
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsj',
  'HBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgo',
  'KCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAAR',
  'CAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAA',
  'AAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAA',
  'AAAAAAAAAAD/2gAMAwEAAhEDEQA/AKcAB//Z',
].join('');

export function openFixtureTakeover({ clock } = {}) {
  return createDeterministicTakeoverChannel({
    clock,
    initialFrame: { jpeg: JPEG, width: 1, height: 1 },
  });
}

function createLatch() {
  let resolveFn;
  const latch = { settled: false, value: null, promise: null, resolve: null };
  latch.promise = new Promise((resolve) => { resolveFn = resolve; });
  latch.resolve = (value) => {
    if (latch.settled) return;
    latch.settled = true;
    latch.value = value;
    resolveFn(value);
  };
  return latch;
}

async function waitForLatchOrDeadline({ latch, clock, signal, expiresAt, sessionDeadlineAt }) {
  if (latch.settled) return latch.value;
  const controller = new AbortController();
  const combined = combineAbortSignals(signal, controller.signal);
  const timeoutPromise = (async () => {
    while (!latch.settled && clock.now() < expiresAt) {
      assertAuthTask({ signal: combined, deadlineAt: sessionDeadlineAt, clock });
      const remaining = expiresAt - clock.now();
      if (remaining <= 0) break;
      try {
        await clock.sleep(remaining, combined);
      } catch (error) {
        if (controller.signal.aborted) return null;
        throw error;
      }
    }
    return 'timeout';
  })();
  try {
    const result = await Promise.race([latch.promise, timeoutPromise]);
    assertAuthTask({ signal, deadlineAt: sessionDeadlineAt, clock });
    return result;
  } finally {
    controller.abort();
    await timeoutPromise.catch(() => {});
  }
}

/**
 * Create the zero-browser Fixture ConsoleLoginDriverPort adapter with a per-session
 * completion latch driven by consoleExtraRoutes.
 */
export function createFixtureConsoleLoginDriver({
  authPort,
  seal,
  clock,
  parsedEnv = null,
  mockPasswordLoginFn = mockPasswordLogin,
  createReloginContextFn = createFixtureReloginContext,
  onCaptureQr,
  onTakeoverClose,
  onPageClose,
} = {}) {
  validateDriverDependencies({ authPort, seal });
  const resolvedClock = resolveClock(clock);
  const latches = new Map();

  function completeSession(sessionId, outcome) {
    if (!['success', 'timeout'].includes(outcome)) throw invalidTakeoverInput();
    const latch = latches.get(sessionId);
    if (!latch || latch.settled) {
      const error = new PddCliError({
        code: 'E_CONSOLE_SESSION_STATE',
        message: '登录状态已变化',
        exitCode: ExitCodes.USAGE,
      });
      error.httpStatus = 409;
      throw error;
    }
    latch.resolve(outcome);
  }

  async function openSession({ sessionId, mode, ownerTag, deviceState, signal, deadlineAt } = {}) {
    validateDriverOpenParams({
      sessionId,
      mode,
      ownerTag,
      deviceState,
      signal,
      deadlineAt,
      clock: resolvedClock,
    });
    const latch = createLatch();
    latches.set(sessionId, latch);

    return createDriverSessionHandle({
      signal,
      deadlineAt,
      clock: resolvedClock,
      authPort,
      seal,
      runPassword: (_credential, task) => mockPasswordLoginFn(task, parsedEnv),
      runCaptureQr: async () => {
        if (onCaptureQr) await onCaptureQr(sessionId);
        return FIXTURE_QR_IMAGE;
      },
      runOpenTakeover: async () => {
        const channel = openFixtureTakeover({ clock: resolvedClock });
        return {
          ...channel,
          close() {
            channel.close();
            onTakeoverClose?.(sessionId);
          },
        };
      },
      runSubmitSms: async () => ({ outcome: 'submitted' }),
      runWaitForAcquisition: ({ signal: waitSignal, expiresAt, sessionDeadlineAt }) => waitForLatchOrDeadline({
        latch,
        clock: resolvedClock,
        signal: waitSignal,
        expiresAt,
        sessionDeadlineAt,
      }),
      getVerifyTarget: ({ expectedMallId } = {}) => createReloginContextFn(expectedMallId ?? null),
      closePage: () => { onPageClose?.(sessionId); },
      closeResources: () => {
        latches.delete(sessionId);
        latch.resolve('cancelled');
      },
    });
  }

  return Object.freeze({ openSession, completeSession });
}
