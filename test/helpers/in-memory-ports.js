import { PddCliError, ExitCodes, daemonStopTimeout } from '../../src/infra/errors.js';
import { buildMallContext, normalizeMallRecord } from '../../src/adapter/mall-context.js';
import { requireMallId } from '../../src/adapter/mall-id.js';
import { createCandidateSeal, deepFreeze } from '../../src/infra/candidate-seal.js';
import { boundMerchantMallId } from '../../src/infra/auth-task.js';

const OWNER_TAG_PATTERN = /^[a-z0-9-]{1,32}$/;

function browserRuntimeError(reason, message = '浏览器运行时配置无效') {
  return new PddCliError({
    code: 'E_BROWSER_RUNTIME',
    message,
    hint: '确认浏览器版本与当前操作系统受支持，并重新安装 Patchright Chromium',
    detail: { reason },
    exitCode: ExitCodes.GENERAL,
  });
}

function assertValidOwnerTag(ownerTag) {
  if (ownerTag !== undefined && (typeof ownerTag !== 'string' || !OWNER_TAG_PATTERN.test(ownerTag))) {
    throw browserRuntimeError('invalid_owner_tag');
  }
}

function assertValidStorageState(storageState, { required = false } = {}) {
  if (!storageState && !required) return;
  if (!Array.isArray(storageState?.cookies) || !Array.isArray(storageState?.origins)) {
    throw browserRuntimeError('snapshot_shape_invalid');
  }
}

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
