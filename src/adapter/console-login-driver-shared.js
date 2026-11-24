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

function assertSessionActive(state, { signal, deadlineAt, clock }, extra = {}) {
  if (state.closed) throw closedSessionError();
  const activeSignal = combineAbortSignals(signal, extra.signal);
  const activeDeadline = extra.deadlineAt ?? deadlineAt;
  assertAuthTask({ signal: activeSignal, deadlineAt: activeDeadline, clock });
  return { activeSignal, activeDeadline };
}

async function closeActiveTakeover(state) {
  const activeTakeover = state.takeover;
  state.takeover = null;
  if (activeTakeover) await activeTakeover.close();
}

async function runSessionQrCapture(state, deps) {
  assertSessionActive(state, deps);
  const capturePromise = (async () => {
    const imageUrl = await deps.runCaptureQr();
    assertAuthTask({ signal: deps.signal, deadlineAt: deps.deadlineAt, clock: deps.clock });
    return imageUrl;
  })();
  state.inFlightQr = capturePromise;
  try {
    return await capturePromise;
  } finally {
    if (state.inFlightQr === capturePromise) state.inFlightQr = null;
  }
}

async function openSessionTakeover(state, deps) {
  assertSessionActive(state, deps);
  await closeActiveTakeover(state).catch(() => {});
  const channel = await deps.runOpenTakeover();
  try {
    assertSessionActive(state, deps);
  } catch (error) {
    await channel.close().catch(() => {});
    throw error;
  }
  state.takeover = channel;
  return createTakeoverFacade(channel);
}

async function verifySessionAcquisition(state, deps, { expectedMallId, state: accountState, signal, deadlineAt } = {}) {
  if (state.inFlightQr) await state.inFlightQr.catch(() => {});
  const { activeSignal, activeDeadline } = assertSessionActive(state, deps, { signal, deadlineAt });
  await closeActiveTakeover(state);
  if (!state.pageClosed) {
    state.pageClosed = true;
    await deps.closePage();
  }
  const target = await deps.getVerifyTarget({ expectedMallId, state: accountState });
  const result = await deps.authPort.verifyAndSeal(target, {
    expectedMallId,
    state: accountState,
    signal: activeSignal,
    deadlineAt: activeDeadline,
    seal: deps.seal,
  });
  assertMerchantVerified(result);
  deps.seal.assert(result.candidate);
  return result;
}

function closeSessionHandle(state, closeResources) {
  if (state.closePromise) return state.closePromise;
  state.closePromise = (async () => {
    state.closed = true;
    try { await closeActiveTakeover(state); } catch { /* Always attempt remaining cleanup. */ }
    try { await closeResources(); } catch { /* Browser may have exited on cancellation. */ }
  })();
  return state.closePromise;
}

/**
 * Build an opaque DriverSessionHandle that encapsulates internal resources, tracks in-flight
 * QR captures, enforces drain -> close -> verify ordering, and guarantees idempotent cleanup.
 */
export function createDriverSessionHandle(deps) {
  const state = { takeover: null, inFlightQr: null, pageClosed: false, closed: false, closePromise: null };
  return Object.freeze({
    async attemptPassword(credential, options = {}) {
      const { activeSignal, activeDeadline } = assertSessionActive(state, deps, options);
      const cappedDeadline = Math.min(activeDeadline ?? Infinity, deps.clock.now() + 70_000);
      return deps.runPassword(credential, { ...options, signal: activeSignal, deadlineAt: cappedDeadline });
    },
    captureQr: () => runSessionQrCapture(state, deps),
    openTakeover: () => openSessionTakeover(state, deps),
    async submitSmsCode(code) {
      const validated = validateSmsCode(code);
      assertSessionActive(state, deps);
      const cappedDeadline = Math.min(deps.deadlineAt ?? Infinity, deps.clock.now() + 15_000);
      return deps.runSubmitSms(validated, { signal: deps.signal, deadlineAt: cappedDeadline });
    },
    async waitForAcquisition({ signal: waitSignal, expiresAt } = {}) {
      if (state.closed) throw closedSessionError();
      const activeSignal = combineAbortSignals(deps.signal, waitSignal);
      assertAuthTask({ signal: activeSignal, deadlineAt: deps.deadlineAt, clock: deps.clock });
      return deps.runWaitForAcquisition({
        signal: activeSignal,
        expiresAt: expiresAt ?? deps.deadlineAt,
        sessionDeadlineAt: deps.deadlineAt,
      });
    },
    verify: (options) => verifySessionAcquisition(state, deps, options),
    close: () => closeSessionHandle(state, deps.closeResources),
  });
}
