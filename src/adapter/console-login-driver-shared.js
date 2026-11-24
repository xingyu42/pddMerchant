import { assertAuthTask, assertMerchantVerified } from '../infra/auth-task.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { assertValidOwnerTag, assertValidStorageState } from './browser-validation.js';
import { invalidTakeoverInput, validateSmsCode } from './takeover.js';

const DRIVER_MODES = new Set(['password', 'qr', 'add']);

/** Validate shared AuthPort and CandidateSeal dependencies required by all console login drivers. */
export function validateDriverDependencies({ authPort, seal }) {
  if (!authPort || typeof authPort.verifyAndSeal !== 'function') {
    throw new PddCliError({
      code: 'E_CONFIG_INVALID',
      message: 'ConsoleLoginDriverPort 需要有效的 AuthPort 实例',
      exitCode: ExitCodes.GENERAL,
    });
  }
  if (!seal || typeof seal.assert !== 'function') {
    throw new PddCliError({
      code: 'E_CONFIG_INVALID',
      message: 'ConsoleLoginDriverPort 需要有效的 CandidateSeal 实例',
      exitCode: ExitCodes.GENERAL,
    });
  }
}

/** Validate ConsoleLoginDriverPort.openSession inputs and return a cloned device snapshot. */
export function validateDriverOpenParams({ sessionId, mode, ownerTag, deviceState, signal, deadlineAt, clock }) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) throw invalidTakeoverInput();
  if (!DRIVER_MODES.has(mode)) throw invalidTakeoverInput();
  assertValidOwnerTag(ownerTag);
  const storageState = deviceState ?? { cookies: [], origins: [] };
  assertValidStorageState(storageState, { required: true });
  assertAuthTask({ signal, deadlineAt, clock });
  return structuredClone({ cookies: storageState.cookies, origins: storageState.origins });
}

/** Combine session-level and per-operation AbortSignals when both are present. */
export function combineAbortSignals(primary, secondary) {
  if (primary && secondary && primary !== secondary) {
    return AbortSignal.any([primary, secondary]);
  }
  return secondary ?? primary;
}

function closedSessionError() {
  return new PddCliError({
    code: 'E_AUTH_CANCELLED',
    message: '认证会话已关闭',
    exitCode: ExitCodes.NETWORK,
  });
}

function createTakeoverFacade(channel) {
  return Object.freeze({
    frames: channel.frames,
    dispatchPointer: (events, batch) => channel.dispatchPointer(events, batch),
    insertText: (text) => channel.insertText(text),
    pressKey: (key) => channel.pressKey(key),
  });
}

/**
 * Build an opaque DriverSessionHandle that encapsulates internal resources, tracks in-flight
 * QR captures, enforces drain -> close -> verify ordering, and guarantees idempotent cleanup.
 */
export function createDriverSessionHandle({
  signal,
  deadlineAt,
  clock,
  authPort,
  seal,
  runPassword,
  runCaptureQr,
  runOpenTakeover,
  runSubmitSms,
  runWaitForAcquisition,
  getVerifyTarget,
  closePage,
  closeResources,
}) {
  let takeover = null;
  let inFlightQr = null;
  let pageClosed = false;
  let closed = false;
  let closePromise = null;

  function assertActive(extra = {}) {
    if (closed) throw closedSessionError();
    const activeSignal = combineAbortSignals(signal, extra.signal);
    const activeDeadline = extra.deadlineAt ?? deadlineAt;
    assertAuthTask({ signal: activeSignal, deadlineAt: activeDeadline, clock });
    return { activeSignal, activeDeadline };
  }

  async function closeActiveTakeover() {
    const activeTakeover = takeover;
    takeover = null;
    if (activeTakeover) await activeTakeover.close();
  }

  async function attemptPassword(credential, options = {}) {
    const { activeSignal, activeDeadline } = assertActive(options);
    const cappedDeadline = Math.min(activeDeadline ?? Infinity, clock.now() + 70_000);
    return runPassword(credential, { ...options, signal: activeSignal, deadlineAt: cappedDeadline });
  }

  async function captureQr() {
    assertActive();
    const capturePromise = (async () => {
      const imageUrl = await runCaptureQr();
      assertAuthTask({ signal, deadlineAt, clock });
      return imageUrl;
    })();
    inFlightQr = capturePromise;
    try {
      return await capturePromise;
    } finally {
      if (inFlightQr === capturePromise) inFlightQr = null;
    }
  }

  async function openTakeover() {
    assertActive();
    await closeActiveTakeover().catch(() => {});
    const channel = await runOpenTakeover();
    try {
      assertActive();
    } catch (error) {
      await channel.close().catch(() => {});
      throw error;
    }
    takeover = channel;
    return createTakeoverFacade(channel);
  }

  async function submitSmsCode(code) {
    const validated = validateSmsCode(code);
    assertActive();
    const cappedDeadline = Math.min(deadlineAt ?? Infinity, clock.now() + 15_000);
    return runSubmitSms(validated, { signal, deadlineAt: cappedDeadline });
  }

  async function waitForAcquisition({ signal: waitSignal, expiresAt } = {}) {
    if (closed) throw closedSessionError();
    const activeSignal = combineAbortSignals(signal, waitSignal);
    assertAuthTask({ signal: activeSignal, deadlineAt, clock });
    return runWaitForAcquisition({
      signal: activeSignal,
      expiresAt: expiresAt ?? deadlineAt,
      sessionDeadlineAt: deadlineAt,
    });
  }

  async function verify({ expectedMallId, state, signal: verifySignal, deadlineAt: verifyDeadlineAt } = {}) {
    if (inFlightQr) await inFlightQr.catch(() => {});
    const { activeSignal, activeDeadline } = assertActive({
      signal: verifySignal,
      deadlineAt: verifyDeadlineAt,
    });
    await closeActiveTakeover();
    if (!pageClosed) {
      pageClosed = true;
      await closePage();
    }
    const target = await getVerifyTarget({ expectedMallId, state });
    const result = await authPort.verifyAndSeal(target, {
      expectedMallId,
      state,
      signal: activeSignal,
      deadlineAt: activeDeadline,
      seal,
    });
    assertMerchantVerified(result);
    seal.assert(result.candidate);
    return result;
  }

  async function close() {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      closed = true;
      try { await closeActiveTakeover(); } catch { /* Always attempt remaining cleanup. */ }
      try { await closeResources(); } catch { /* Browser may have exited on cancellation. */ }
    })();
    return closePromise;
  }

  return Object.freeze({
    attemptPassword,
    captureQr,
    openTakeover,
    submitSmsCode,
    waitForAcquisition,
    verify,
    close,
  });
}
