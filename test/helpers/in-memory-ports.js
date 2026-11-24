import { PddCliError, ExitCodes, daemonStopTimeout } from '../../src/infra/errors.js';
import { buildMallContext, normalizeMallRecord } from '../../src/adapter/mall-context.js';
import { requireMallId } from '../../src/adapter/mall-id.js';
import { createCandidateSeal, deepFreeze } from '../../src/infra/candidate-seal.js';
import { assertAuthTask, boundMerchantMallId } from '../../src/infra/auth-task.js';
import { resolveClock } from '../../src/infra/clock.js';
import { createLatestFrames } from '../../src/adapter/latest-frames.js';
import {
  validatePointerBatch,
  validateText,
  validateKey,
  createPointerReplay,
  inputQueue,
  invalidTakeoverInput,
} from '../../src/adapter/takeover.js';
import {
  combineAbortSignals,
  createDriverSessionHandle,
  validateDriverDependencies,
  validateDriverOpenParams,
} from '../../src/adapter/console-login-driver-shared.js';
import {
  browserRuntimeError,
  assertValidOwnerTag,
  assertValidStorageState,
} from '../../src/adapter/browser-validation.js';

function makeMemoryPage(context) {
  return {
    __memory: true,
    context: () => context,
    url: () => 'https://mms.pinduoduo.com',
    goto: async () => {},
    close: async () => {},
  };
}

function makeMemoryContext(storageState) {
  const snapshot = structuredClone({
    cookies: storageState?.cookies ?? [],
    origins: storageState?.origins ?? [],
  });
  const context = {
    __memory: true,
    storageState: async () => structuredClone(snapshot),
    cookies: async () => structuredClone(snapshot.cookies),
    newPage: async () => makeMemoryPage(context),
    close: async () => {},
  };
  return context;
}

/** Create an in-memory BrowserRuntimePort test double with instance-scoped session tracking. */
export function createInMemoryBrowserRuntime({
  available = true,
  reclaimCount = 0,
  onLaunch,
  createPage,
} = {}) {
  const activeSessions = new Set();
  const sessionRecords = new WeakMap();
  const launches = [];
  const derivedContexts = [];
  let closeAllInFlight = null;

  function activeRecord(session) {
    const record = session && typeof session === 'object' ? sessionRecords.get(session) : null;
    if (!record || record.closed) throw browserRuntimeError('browser_profile_missing');
    return record;
  }

  async function checkAvailability() {
    return {
      ok: Boolean(available),
      detail: available ? { memory: true } : { error: 'chromium 不可用' },
    };
  }

  async function openSession(options = {}) {
    const { headed = false, storageState, ownerTag } = options;
    assertValidOwnerTag(ownerTag);
    assertValidStorageState(storageState);
    if (onLaunch) await onLaunch(options);

    const context = makeMemoryContext(storageState);
    const page = createPage ? createPage(context, options) : makeMemoryPage(context);
    const profile = Object.freeze({
      mode: headed ? 'headed' : 'headless',
      channel: 'memory',
      version: '136.0.0.0',
    });
    const record = { closed: false, profile, session: null };

    const session = Object.freeze({
      page,
      context,
      async close() {
        if (record.closed) return;
        record.closed = true;
        activeSessions.delete(session);
        await page.close?.();
        await context.close?.();
      },
      async createSnapshotContext(snapshotState) {
        activeRecord(session);
        assertValidStorageState(snapshotState, { required: true });
        return makeMemoryContext(snapshotState);
      },
    });

    record.session = session;
    sessionRecords.set(session, record);
    activeSessions.add(session);
    launches.push({ headed, ownerTag, storageState: storageState ? structuredClone({ cookies: storageState.cookies, origins: storageState.origins }) : undefined });
    return session;
  }

  async function withSession(optionsOrFn, maybeFn) {
    const hasOptions = typeof optionsOrFn !== 'function';
    const options = hasOptions ? (optionsOrFn ?? {}) : {};
    const fn = hasOptions ? maybeFn : optionsOrFn;
    const session = await openSession(options);
    try {
      return await fn(session);
    } finally {
      await session.close();
    }
  }

  async function deriveConsumerContext(session, { storageState, proxy } = {}) {
    const record = activeRecord(session);
    assertValidStorageState(storageState);
    const context = makeMemoryContext(storageState);
    const page = createPage ? createPage(context, { storageState, proxy }) : makeMemoryPage(context);
    const entry = { profile: record.profile, proxy: proxy ?? null, storageState: storageState ? structuredClone({ cookies: storageState.cookies, origins: storageState.origins }) : null };
    derivedContexts.push(entry);
    return {
      context,
      page,
      async close() {
        await page.close?.();
        await context.close?.();
      },
    };
  }

  async function reclaimOrphans() {
    return reclaimCount;
  }

  async function closeAll() {
    if (closeAllInFlight) return closeAllInFlight;
    closeAllInFlight = (async () => {
      const snapshot = [...activeSessions];
      await Promise.allSettled(snapshot.map((session) => session.close()));
    })();
    try {
      return await closeAllInFlight;
    } finally {
      closeAllInFlight = null;
    }
  }

  return Object.freeze({
    checkAvailability,
    withSession,
    openSession,
    deriveConsumerContext,
    reclaimOrphans,
    closeAll,
    launches,
    derivedContexts,
  });
}

/** Create an in-memory MallPort test double sharing the exact normalization and strict ID rules. */
export function createInMemoryMallPort({
  currentMall = { id: '900001', name: 'Memory Shop' },
  malls = [currentMall].filter(Boolean),
  source = 'memory',
  noSwitchUi = false,
  simulateSwitchMismatch = false,
} = {}) {
  let active = currentMall ? normalizeMallRecord(currentMall) : null;
  if (active && !active.id) active = null;
  const rawList = Array.isArray(malls) ? [...malls] : [];

  async function detectCurrentMall() {
    return buildMallContext({
      activeId: active?.id ?? null,
      activeName: active?.name ?? '',
      malls: rawList,
      source: active?.id ? source : null,
    });
  }

  async function listMalls() {
    const ctx = await detectCurrentMall();
    if (ctx.malls.length > 0) return ctx.malls;
    if (ctx.activeId) return [{ id: ctx.activeId, name: ctx.activeName, is_current: true }];
    throw new PddCliError({
      code: 'E_MALL_LIST_EMPTY',
      message: '未能获取店铺列表',
      hint: '确认已登录，或手动在浏览器中点击店铺切换下拉确认 UI',
      exitCode: ExitCodes.GENERAL,
    });
  }

  async function switchMall(_target, mallId, { strict } = {}) {
    const validatedId = requireMallId(mallId, { strict });
    if (active?.id === validatedId) {
      return { id: active.id, name: active.name, source };
    }
    if (noSwitchUi) {
      throw new PddCliError({
        code: 'E_MALL_SWITCH_NO_UI',
        message: '未找到店铺切换入口（单店铺账号或 UI 改版）',
        hint: '单店铺账号无需切换；确认当前店铺或升级 mall-switcher selector',
        exitCode: ExitCodes.GENERAL,
      });
    }
    const normalizedMalls = await listMalls().catch((error) => {
      if (error?.code === 'E_MALL_LIST_EMPTY') return [];
      throw error;
    });
    const found = normalizedMalls.find((item) => item.id === validatedId);
    if (!found) {
      throw new PddCliError({
        code: 'E_MALL_NOT_FOUND',
        message: `未找到店铺 ${validatedId}`,
        hint: '执行 pdd shops list 查看可用店铺',
        exitCode: ExitCodes.USAGE,
      });
    }
    if (simulateSwitchMismatch) {
      throw new PddCliError({
        code: 'E_MALL_SWITCH_FAILED',
        message: `店铺切换失败：期望 ${validatedId}，实际 ${active?.id ?? 'null'}`,
        hint: '重试 pdd shops list 确认目标店铺 ID',
        exitCode: ExitCodes.GENERAL,
      });
    }
    active = { id: found.id, name: found.name, is_current: true };
    return { id: found.id, name: found.name, source };
  }

  return Object.freeze({
    detectCurrentMall,
    listMalls,
    switchMall,
  });
}

/** Create an in-memory DaemonProcessPort test double with synthetic PIDs and kill guards. */
export function createInMemoryDaemonProcessPort({
  initialPids = [],
  selfPid = process.pid,
  failKillPids = new Set(),
  onSpawn,
} = {}) {
  let nextPid = 10000;
  const processes = new Map();
  for (const pid of initialPids) {
    if (Number.isSafeInteger(pid) && pid > 0) {
      processes.set(pid, { alive: true, args: ['daemon', 'run'], env: {} });
    }
  }

  function spawnDetached({ env: extraEnv } = {}) {
    let pid = ++nextPid;
    while (processes.has(pid) || pid === selfPid) pid = ++nextPid;
    const record = { alive: true, args: ['daemon', 'run'], env: { ...(extraEnv ?? {}) } };
    processes.set(pid, record);
    onSpawn?.(pid, record);
    return { pid };
  }

  function stopByPid(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === selfPid) {
      throw daemonStopTimeout({ reason: 'kill_failed' });
    }
    if (failKillPids.has(pid)) {
      throw daemonStopTimeout({ pid, reason: 'kill_failed' });
    }
    const existing = processes.get(pid);
    if (!existing || !existing.alive) {
      return { stopped: true, alreadyExited: true };
    }
    existing.alive = false;
    return { stopped: true, alreadyExited: false };
  }

  function isRunning(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    return processes.get(pid)?.alive === true;
  }

  return Object.freeze({
    spawnDetached,
    stopByPid,
    isRunning,
    processes,
  });
}

/** Create an in-memory 3-method AuthPort test double with CandidateSeal and authoritative support. */
export function createInMemoryAuthPort({
  seal = createCandidateSeal(),
  authoritative = true,
  merchantVerdict = 'verified',
  merchantIdentity = { mallId: '900001', displayName: 'Memory Shop' },
  consumerOnline = true,
  consumerUrl = 'https://mobile.yangkeduo.com/home',
  requirePassId = false,
  now = Date.now,
} = {}) {
  if (!seal || typeof seal.seal !== 'function' || typeof seal.assert !== 'function') {
    throw new PddCliError({
      code: 'E_CONFIG_INVALID',
      message: 'createInMemoryAuthPort 需要有效的 CandidateSeal 实例',
      exitCode: ExitCodes.GENERAL,
    });
  }
  const checkedAt = () => new Date(now()).toISOString();

  function hasValidPassId(state) {
    return Array.isArray(state?.cookies) && state.cookies.some((cookie) => cookie.name === 'PASS_ID' && cookie.value);
  }

  async function checkMerchant(state, options = {}) {
    if (options.signal?.aborted) {
      return { verdict: 'indeterminate', reason: 'cancelled', http_status: null, checked_at: checkedAt(), authoritative };
    }
    if (options.deadlineAt != null && now() >= options.deadlineAt) {
      return { verdict: 'indeterminate', reason: 'deadline', http_status: null, checked_at: checkedAt(), authoritative };
    }
    if (!options.force && state?.merchant_auth?.last_check?.verdict === 'rejected') {
      return { verdict: 'rejected', reason: 'known_rejected', http_status: null, checked_at: checkedAt(), authoritative };
    }
    if (requirePassId && !hasValidPassId(state)) {
      throw new PddCliError({
        code: 'E_AUTH_CANDIDATE_INVALID',
        message: '候选登录材料无法用于协议核验',
        detail: { reason: 'pass_id_missing' },
        exitCode: ExitCodes.AUTH,
      });
    }
    const resolved = typeof merchantVerdict === 'function' ? await merchantVerdict(state, options) : merchantVerdict;
    const verdict = typeof resolved === 'string' ? resolved : resolved.verdict;
    if (verdict === 'rejected') {
      return { verdict: 'rejected', reason: resolved?.reason ?? 'login_false', http_status: resolved?.http_status ?? 200, checked_at: checkedAt(), authoritative };
    }
    if (verdict === 'indeterminate') {
      return { verdict: 'indeterminate', reason: resolved?.reason ?? 'network_error', http_status: resolved?.http_status ?? null, checked_at: checkedAt(), authoritative };
    }
    return { verdict: 'verified', reason: 'login_true', http_status: 200, checked_at: checkedAt(), authoritative };
  }

  async function verifyAndSeal(sessionOrContext, options = {}) {
    const activeSeal = options.seal === undefined ? seal : options.seal;
    if (!activeSeal || typeof activeSeal.seal !== 'function' || typeof activeSeal.assert !== 'function') {
      throw new PddCliError({
        code: 'E_CONFIG_INVALID',
        message: 'verifyAndSeal 需要有效的 CandidateSeal 实例',
        exitCode: ExitCodes.GENERAL,
      });
    }
    if (options.state?.merchant_auth?.last_check?.verdict === 'rejected') {
      return { verdict: 'rejected', reason: 'known_rejected', checked_at: checkedAt(), http_status: null, authoritative };
    }
    const boundMallId = boundMerchantMallId(options.state);
    if (boundMallId && options.expectedMallId != null && String(options.expectedMallId) !== boundMallId) {
      return { verdict: 'failed', reason: 'identity_mismatch', checked_at: checkedAt(), http_status: null, authoritative };
    }
    if (options.signal?.aborted) {
      return { verdict: 'indeterminate', reason: 'cancelled', checked_at: checkedAt(), http_status: null, authoritative };
    }
    if (options.deadlineAt != null && now() >= options.deadlineAt) {
      return { verdict: 'indeterminate', reason: 'deadline', checked_at: checkedAt(), http_status: null, authoritative };
    }

    const context = sessionOrContext?.context ?? sessionOrContext;
    const rawState = context?.storageState ? await context.storageState() : (options.state ?? { cookies: [], origins: [] });
    const snapshot = deepFreeze(structuredClone(rawState));

    if (requirePassId && !hasValidPassId(snapshot)) {
      return { verdict: 'rejected', reason: 'auth_missing', checked_at: checkedAt(), http_status: null, authoritative };
    }
    const resolved = typeof merchantVerdict === 'function' ? await merchantVerdict(snapshot, options) : merchantVerdict;
    const verdict = typeof resolved === 'string' ? resolved : resolved.verdict;
    if (verdict === 'rejected') {
      return { verdict: 'rejected', reason: resolved?.reason ?? 'login_false', checked_at: checkedAt(), http_status: resolved?.http_status ?? 200, authoritative };
    }
    if (verdict !== 'verified') {
      return { verdict: 'indeterminate', reason: resolved?.reason ?? 'network_error', checked_at: checkedAt(), http_status: resolved?.http_status ?? null, authoritative };
    }
    const identity = typeof merchantIdentity === 'function' ? await merchantIdentity(snapshot, options) : merchantIdentity;
    const resolvedExpectedMallId = options.expectedMallId ?? boundMallId;
    if (resolvedExpectedMallId != null && String(resolvedExpectedMallId) !== String(identity.mallId)) {
      return { verdict: 'failed', reason: 'identity_mismatch', checked_at: checkedAt(), http_status: 200, authoritative };
    }
    const time = checkedAt();
    const normalizedIdentity = { mallId: String(identity.mallId), displayName: String(identity.displayName ?? '') };
    const candidate = activeSeal.seal({ state: snapshot, identity: normalizedIdentity, checked_at: time, scope: 'shop_read' });
    return {
      verdict: 'verified',
      reason: 'shop_read',
      checked_at: time,
      http_status: 200,
      identity: normalizedIdentity,
      candidate,
      authoritative,
    };
  }

  async function checkConsumerOnline(target, options = {}) {
    const ok = typeof consumerOnline === 'function' ? await consumerOnline(target, options) : Boolean(consumerOnline);
    return {
      ok,
      authoritative,
      detail: { url: ok ? consumerUrl : null },
    };
  }

  return Object.freeze({
    checkMerchant,
    verifyAndSeal,
    checkConsumerOnline,
  });
}

const INMEMORY_QR_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVR4nGP4+vUrAAXCAuCuRnaIAAAAAElFTkSuQmCC';

function createMemoryLatch() {
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

function createMemoryTakeoverChannel({ sessionRecord, onTakeoverClose }) {
  const frames = createLatestFrames();
  const controller = new AbortController();
  const enqueue = inputQueue(controller.signal);
  const replay = createPointerReplay({
    state: { pressed: false },
    signal: controller.signal,
    enqueue,
    dispatch: async () => {},
  });
  sessionRecord.frames = frames;
  return {
    frames,
    dispatchPointer(input, metadata) {
      const batch = validatePointerBatch(input, metadata);
      sessionRecord.pointerCalls.push({ events: input, metadata });
      return enqueue(async () => {
        const interrupted = await replay(batch);
        if (interrupted) return interrupted;
        const released = batch.events.some((event) => event.type === 'up');
        return released ? { editable: false, numeric: false } : { editable: null, numeric: null };
      });
    },
    insertText(text) {
      const validated = validateText(text);
      sessionRecord.textCalls.push(validated);
      return Promise.resolve();
    },
    pressKey(key) {
      const validated = validateKey(key);
      sessionRecord.keyCalls.push(validated.key);
      return Promise.resolve();
    },
    close() {
      if (controller.signal.aborted) return;
      controller.abort();
      frames.close();
      sessionRecord.timeline.push('takeover_closed');
      onTakeoverClose?.(sessionRecord.sessionId);
    },
  };
}

async function waitForMemoryLatch({ latch, clock, signal, expiresAt, sessionDeadlineAt }) {
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

/** Create a deterministic InMemory ConsoleLoginDriverPort double sharing takeover validation and verify contracts. */
export function createInMemoryConsoleLoginDriver({
  seal = createCandidateSeal(),
  authPort = createInMemoryAuthPort({ seal }),
  clock,
  passwordOutcome = { outcome: 'success' },
  smsOutcome = { outcome: 'submitted' },
  qrImage = INMEMORY_QR_IMAGE,
  contextState = { cookies: [{ name: 'PASS_ID', value: 'memory-pass', domain: '.pinduoduo.com', path: '/' }], origins: [] },
  onOpenSession,
  onCaptureQr,
  onSubmitSms,
  onTakeoverClose,
  onPageClose,
  onClose,
} = {}) {
  validateDriverDependencies({ authPort, seal });
  const resolvedClock = resolveClock(clock);
  const sessions = new Map();
  const orderedIds = [];

  function completeSession(sessionId, outcome = 'success') {
    if (!['success', 'timeout'].includes(outcome)) throw invalidTakeoverInput();
    const record = sessions.get(sessionId);
    if (!record) throw invalidTakeoverInput();
    record.latch.resolve(outcome);
  }

  function emitFrame(sessionId, frame) {
    const record = sessions.get(sessionId);
    record?.frames?.publish(frame);
  }

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
    const record = {
      sessionId,
      mode,
      ownerTag,
      deviceState: storageState,
      latch: createMemoryLatch(),
      frames: null,
      timeline: ['opened'],
      pointerCalls: [],
      textCalls: [],
      keyCalls: [],
      smsCalls: [],
      closed: false,
    };
    sessions.set(sessionId, record);
    orderedIds.push(sessionId);
    if (onOpenSession) await onOpenSession(record);

    return createDriverSessionHandle({
      signal,
      deadlineAt,
      clock: resolvedClock,
      authPort,
      seal,
      runPassword: async (credential, task) => {
        record.timeline.push('password_attempted');
        return typeof passwordOutcome === 'function'
          ? passwordOutcome(credential, task, record)
          : passwordOutcome;
      },
      runCaptureQr: async () => {
        record.timeline.push('qr_captured');
        if (onCaptureQr) {
          const custom = await onCaptureQr(record);
          if (typeof custom === 'string') return custom;
        }
        return qrImage;
      },
      runOpenTakeover: async () => {
        record.timeline.push('takeover_opened');
        return createMemoryTakeoverChannel({ sessionRecord: record, onTakeoverClose });
      },
      runSubmitSms: async (code, task) => {
        record.smsCalls.push(code);
        record.timeline.push('sms_submitted');
        if (onSubmitSms) return onSubmitSms(code, task, record);
        return typeof smsOutcome === 'function' ? smsOutcome(code, task, record) : smsOutcome;
      },
      runWaitForAcquisition: ({ signal: waitSignal, expiresAt, sessionDeadlineAt }) => waitForMemoryLatch({
        latch: record.latch,
        clock: resolvedClock,
        signal: waitSignal,
        expiresAt,
        sessionDeadlineAt,
      }),
      getVerifyTarget: () => ({
        storageState: async () => structuredClone(
          typeof contextState === 'function' ? contextState(record) : contextState,
        ),
      }),
      closePage: () => {
        record.timeline.push('page_closed');
        onPageClose?.(sessionId);
      },
      closeResources: async () => {
        record.closed = true;
        record.timeline.push('closed');
        record.latch.resolve('cancelled');
        await onClose?.(record);
      },
    });
  }

  return Object.freeze({
    openSession,
    completeSession,
    emitFrame,
    sessions,
    lastSession: () => (orderedIds.length ? sessions.get(orderedIds.at(-1)) : null),
  });
}
