import { assertAuthTask } from '../infra/auth-task.js';
import { resolveClock } from '../infra/clock.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { hasPassId, MERCHANT_CHECK_URL } from './merchant-auth-probe.js';
import { attemptPasswordLogin, submitSmsCode } from './password-login.js';
import { captureQrElement } from './qr-login.js';
import { openTakeover } from './takeover.js';
import {
  createDriverSessionHandle,
  validateDriverDependencies,
  validateDriverOpenParams,
} from './console-login-driver-shared.js';

function assertBrowserRuntimePort(browserRuntime) {
  if (!browserRuntime || typeof browserRuntime.openSession !== 'function') {
    throw new PddCliError({
      code: 'E_CONFIG_INVALID',
      message: 'createLiveConsoleLoginDriver 需要有效的 BrowserRuntimePort',
      exitCode: ExitCodes.GENERAL,
    });
  }
}

async function pollLivePassId({ context, hasPassIdFn, clock, signal, expiresAt, sessionDeadlineAt }) {
  while (clock.now() < expiresAt) {
    assertAuthTask({ signal, deadlineAt: sessionDeadlineAt, clock });
    const cookies = await context.cookies([MERCHANT_CHECK_URL]);
    if (hasPassIdFn(cookies)) return 'success';
    const remaining = expiresAt - clock.now();
    if (remaining <= 0) break;
    await clock.sleep(Math.min(200, Math.max(1, remaining)), signal);
  }
  assertAuthTask({ signal, deadlineAt: sessionDeadlineAt, clock });
  return 'timeout';
}

/**
 * Create the Live ConsoleLoginDriverPort adapter reusing BrowserRuntimePort (and its Runtime
 * Browser Profile), CDP takeover, password/QR/SMS login, and independent AuthPort verification.
 */
export function createLiveConsoleLoginDriver({
  browserRuntime,
  authPort,
  seal,
  clock,
  attemptPasswordLoginFn,
  submitSmsCodeFn,
  captureQrElementFn,
  openTakeoverFn,
  hasPassIdFn,
} = {}) {
  assertBrowserRuntimePort(browserRuntime);
  validateDriverDependencies({ authPort, seal });
  const resolvedClock = resolveClock(clock);

  async function openSession({ sessionId, mode, ownerTag, deviceState, signal, deadlineAt } = {}) {
    const storageState = validateDriverOpenParams({
      sessionId,
      mode,
      ownerTag,
      deviceState,
      signal,
      deadlineAt,
      clock: resolvedClock,
    });

    const browserSession = await browserRuntime.openSession({ ownerTag, storageState });
    try {
      assertAuthTask({ signal, deadlineAt, clock: resolvedClock });
    } catch (error) {
      await browserSession.close().catch(() => {});
      throw error;
    }

    return createDriverSessionHandle({
      signal,
      deadlineAt,
      clock: resolvedClock,
      authPort,
      seal,
      runPassword: (credential, task) => (attemptPasswordLoginFn ?? attemptPasswordLogin)(browserSession.page, credential, task),
      runCaptureQr: async () => {
        const image = await (captureQrElementFn ?? captureQrElement)(browserSession.page);
        return `data:image/png;base64,${image.toString('base64')}`;
      },
      runOpenTakeover: () => (openTakeoverFn ?? openTakeover)(browserSession.page),
      runSubmitSms: (code, task) => (submitSmsCodeFn ?? submitSmsCode)(browserSession.page, code, task),
      runWaitForAcquisition: ({ signal: waitSignal, expiresAt, sessionDeadlineAt }) => pollLivePassId({
        context: browserSession.context,
        hasPassIdFn: hasPassIdFn ?? hasPassId,
        clock: resolvedClock,
        signal: waitSignal,
        expiresAt,
        sessionDeadlineAt,
      }),
      getVerifyTarget: () => browserSession,
      closePage: () => browserSession.page?.close(),
      closeResources: () => browserSession.close(),
    });
  }

  return Object.freeze({ openSession });
}
