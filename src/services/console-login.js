import { randomBytes } from 'node:crypto';
import { withMerchantAuthUpdate } from '../adapter/merchant-auth-storage.js';
import { assertAuthTask, assertMerchantVerified } from '../infra/auth-task.js';
import { createCandidateSeal } from '../infra/candidate-seal.js';
import { resolveClock } from '../infra/clock.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { invalidTakeoverInput, validateSmsCode } from '../adapter/takeover.js';
import { findAccountByIdentity } from '../infra/account-store.js';
import { assertPasswordCredential, loadPasswordCredential } from '../adapter/password-credential.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import {
  consoleAccount,
  listConsoleAccounts,
  saveConsolePassword,
  clearConsolePassword,
  unblockConsoleAccount,
  removeConsoleAccount,
} from './console-accounts.js';
import { consoleHealth, consoleRequestError } from './console-runtime.js';
import { redeemConsoleToken, resolveConsoleSession, consoleSessionCookie } from './console-auth.js';
import { getConsolePatrol, setConsolePatrol } from './console-patrol.js';
import { saveMerchantLogin, provisionMerchantLogin } from './auth-account-storage.js';
import {
  decideRelogin,
  beginReloginAttempt,
  recordTakeoverTimeout,
  setAccountPassword,
  extractDeviceState,
} from './relogin-policy.js';

const TERMINAL_STATES = new Set(['succeeded', 'failed', 'timed_out', 'cancelled']);
const TAKEOVER_MS = 600_000;
const SESSION_MS = 720_000;
const RETENTION_MS = 300_000;
const AWAITING_HUMAN = new Set(['takeover', 'sms']);
const EMPTY_STATE = Object.freeze({ cookies: [], origins: [] });
const ADD_FAILURES = Object.freeze({
  wrong_password: '登录名或密码错误，店铺未添加',
  account_locked: '账号已锁定，请稍后重试',
  form_changed: '自动填写失败，店铺未添加',
  network_error: '网络异常，店铺未添加，请重试',
});
const FAILURE_MESSAGES = Object.freeze({
  E_ACCOUNT_IDENTITY_MISMATCH: '登录店铺与所选店铺不一致，未保存',
  E_AUTH_RELOGIN_BLOCKED: '自动登录已暂停，请修改密码或扫码登录',
  E_AUTH_EXPIRED: '核验未通过，请重新登录',
  E_PASSWORD_LOGIN_FORM_CHANGED: '自动填写失败，请扫码登录',
  E_AUTH_RELOGIN_FAILED: '登录未完成，请重试或扫码登录',
});

function assertStart(account, mode) {
  if (!['password', 'qr'].includes(mode)) throw invalidTakeoverInput();
  if (mode !== 'password') return;
  const decision = decideRelogin(account.id, { manual: true, decrypt: false });
  if (decision.action !== 'fail') return;
  if (decision.error.code === 'E_AUTH_RELOGIN_BLOCKED') {
    throw consoleRequestError(409, 'E_AUTH_RELOGIN_BLOCKED', '自动登录已暂停，请修改密码或扫码登录');
  }
  throw consoleRequestError(409, 'E_AUTH_PASSWORD_REQUIRED', '请先保存账号密码');
}

function assertRunning(stopping, signal) {
  if (stopping || signal?.aborted) {
    throw consoleRequestError(503, 'E_CONSOLE_STOPPING', '控制台正在停止，请稍后重新打开');
  }
}

function assertDriver(driver) {
  if (!driver || typeof driver.openSession !== 'function') {
    throw new PddCliError({
      code: 'E_CONFIG_INVALID',
      message: 'createConsoleApp 需要有效的 ConsoleLoginDriverPort',
      exitCode: ExitCodes.GENERAL,
    });
  }
}

function setWindow(session, state, duration, nowFn) {
  assertAuthTask({ signal: session.controller.signal });
  session.state = state;
  session.expiresAt = Math.min(session.deadlineAt, nowFn() + duration);
  session.message = state === 'sms' ? '短信验证码已发送到绑定手机' : null;
}

async function openDriverSession(session, driver, deviceState) {
  const handle = await driver.openSession({
    sessionId: session.id,
    mode: session.mode,
    ownerTag: session.ownerTag,
    deviceState,
    signal: session.controller.signal,
    deadlineAt: session.deadlineAt,
  });
  session.handle = handle;
  return handle;
}

function consoleReloginAttempt(session, tx, { seal, commit }, decision = {}) {
  return beginReloginAttempt(tx, {
    ...decision,
    manual: true,
    password: session.mode === 'password',
    seal: tx?.seal ?? seal,
    commit,
  });
}

async function awaitHuman(session, handle, challenge, nowFn) {
  if (challenge === 'sms') return setWindow(session, 'sms', TAKEOVER_MS, nowFn);
  session.takeover = await handle.openTakeover();
  setWindow(session, 'takeover', TAKEOVER_MS, nowFn);
}

async function refreshQrImage(session, clock, handle = session.handle) {
  const capture = (async () => {
    const qrImage = await handle.captureQr();
    assertAuthTask({ signal: session.controller.signal, deadlineAt: session.expiresAt, clock });
    session.qrImage = qrImage;
  })();
  session.refreshing = capture;
  try {
    await capture;
  } finally {
    session.refreshing = null;
  }
}

async function beginQr(session, handle, clock) {
  setWindow(session, 'qr', TIMEOUTS.LOGIN_QR, clock.now);
  await refreshQrImage(session, clock, handle);
}

async function beginPassword(session, tx, handle, { seal, commit, clock }) {
  const decision = decideRelogin(tx.accountId, { manual: true, decrypt: false });
  if (decision.action === 'fail') throw decision.error;
  session.attempt = consoleReloginAttempt(session, tx, { seal, commit }, decision);
  const credential = loadPasswordCredential(tx.accountId);
  const outcome = await handle.attemptPassword(credential, {
    signal: tx.signal,
    deadlineAt: Math.min(session.deadlineAt, clock.now() + 70_000),
  });
  assertAuthTask(tx);
  if (outcome.outcome === 'success') return true;
  // 只有挑战需要人：短信走输入框，其余挑战转播验证码弹窗；表单变化、网络错误等按结果码结束。
  try {
    session.attempt.fail(outcome);
  } catch (error) {
    if (outcome.outcome !== 'challenge' || error.code !== 'E_AUTH_HUMAN_REQUIRED') throw error;
  }
  await awaitHuman(session, handle, outcome.challenge, clock.now);
  return false;
}

function finishTimeout(session) {
  if (AWAITING_HUMAN.has(session.state) && session.accountId != null) {
    recordTakeoverTimeout(session.accountId);
  }
  session.state = 'timed_out';
  session.message = null;
}

async function commitLogin(session, tx, handle, { seal, commit }) {
  session.state = 'verifying';
  session.message = null;
  session.qrImage = null;
  const result = await handle.verify({
    expectedMallId: tx.recoveryMallId,
    state: tx.state,
    signal: tx.signal,
    deadlineAt: tx.deadlineAt,
  });
  assertMerchantVerified(result);
  const attempt = session.attempt ?? consoleReloginAttempt(session, tx, { seal, commit });
  attempt.succeed(result.candidate);
  session.state = 'succeeded';
  session.message = null;
}

async function executeSession(session, tx, account, deps) {
  assertStart(account, session.mode);
  assertAuthTask(tx);
  const handle = await openDriverSession(session, deps.driver, extractDeviceState(tx));
  let acquired = false;
  if (session.mode === 'qr') await beginQr(session, handle, deps.clock);
  else acquired = await beginPassword(session, tx, handle, deps);
  const outcome = acquired
    ? 'success'
    : await handle.waitForAcquisition({ signal: tx.signal, expiresAt: session.expiresAt });
  assertAuthTask(tx);
  if (outcome === 'timeout') return finishTimeout(session);
  await commitLogin(session, tx, handle, deps);
}

// 店铺已登记时更新其登录状态（短租约），否则新建账号；两种情况都保存这次验证过的密码。
async function commitAddedAccount(session, task, handle) {
  session.state = 'verifying';
  session.message = null;
  session.qrImage = null;
  const result = await handle.verify({
    expectedMallId: null,
    signal: task.signal,
    deadlineAt: task.deadlineAt,
  });
  const existed = findAccountByIdentity('merchant', result.identity.mallId) !== null;
  const { account } = await provisionMerchantLogin(async () => result, task);
  setAccountPassword(account.id, session.credential);
  session.state = 'succeeded';
  session.message = existed ? '店铺已存在，登录信息和密码已更新' : '店铺已添加，密码已保存';
}

// 新增账号不持有账号租约、不写重登状态；登录失败直接结束会话，挑战照常交给人。
async function executeAddSession(session, { driver, seal, clock }) {
  const task = {
    signal: session.controller.signal,
    deadlineAt: session.deadlineAt,
    seal,
    clock,
  };
  const handle = await openDriverSession(session, driver, EMPTY_STATE);
  const attempt = await handle.attemptPassword(session.credential, {
    signal: task.signal,
    deadlineAt: Math.min(task.deadlineAt, clock.now() + 70_000),
  });
  assertAuthTask(task);
  if (!['success', 'challenge'].includes(attempt.outcome)) {
    session.state = 'failed';
    session.message = ADD_FAILURES[attempt.outcome] ?? '登录未完成，请重试';
    return;
  }
  if (attempt.outcome === 'challenge') await awaitHuman(session, handle, attempt.challenge, clock.now);
  const outcome = attempt.outcome === 'success'
    ? 'success'
    : await handle.waitForAcquisition({ signal: task.signal, expiresAt: session.expiresAt });
  assertAuthTask(task);
  if (outcome === 'timeout') return finishTimeout(session);
  await commitAddedAccount(session, task, handle);
}

function sessionFailure(session, error, nowFn) {
  if (session.controller.signal.aborted || nowFn() >= session.expiresAt) {
    if (session.expired || !session.controller.signal.aborted) finishTimeout(session);
    else {
      session.state = 'cancelled';
      session.message = null;
    }
    return;
  }
  session.state = 'failed';
  session.message = FAILURE_MESSAGES[error?.code] ?? '登录未完成，请重试';
}

function scheduleExpiry(session, clock, hasCustomClock) {
  if (!hasCustomClock) {
    const timer = setTimeout(() => {
      session.expired = true;
      session.controller.abort();
    }, SESSION_MS);
    return () => clearTimeout(timer);
  }
  const controller = new AbortController();
  void (async () => {
    try {
      await clock.sleep(SESSION_MS, controller.signal);
      session.expired = true;
      session.controller.abort();
    } catch { /* Session completed or closed before expiry. */ }
  })();
  return () => controller.abort();
}

function scheduleRetention(sessions, session, clock, hasCustomClock) {
  if (!hasCustomClock) {
    const timer = setTimeout(() => sessions.delete(session.id), RETENTION_MS);
    timer.unref?.();
    return () => clearTimeout(timer);
  }
  const controller = new AbortController();
  void (async () => {
    try {
      await clock.sleep(RETENTION_MS, controller.signal);
      sessions.delete(session.id);
    } catch { /* Session retention cancelled during shutdown. */ }
  })();
  return () => controller.abort();
}

function findSession(sessions, id) {
  const session = sessions.get(id);
  if (!session) throw consoleRequestError(404, 'E_CONSOLE_SESSION_NOT_FOUND', '登录已结束或不存在');
  return session;
}

function interactiveSession(sessions, id, state) {
  const session = findSession(sessions, id);
  if (session.state !== state || session.controller.signal.aborted) {
    throw consoleRequestError(409, 'E_CONSOLE_SESSION_STATE', '登录状态已变化，请刷新页面');
  }
  return session;
}

function formatSessionStatus(session, nowFn) {
  return {
    state: session.state,
    message: session.message,
    remaining_seconds: TERMINAL_STATES.has(session.state) ? 0 : Math.max(0, Math.ceil((session.expiresAt - nowFn()) / 1000)),
    expires_at: new Date(session.expiresAt).toISOString(),
    qr_image: session.state === 'qr' ? session.qrImage : null,
  };
}

function activeSessions(sessions) {
  return [...sessions.values()].filter((session) => !session.finished);
}

async function runSession(state, session, previous, parentSignal, operation) {
  session.deadlineAt = session.expiresAt;
  const abort = () => session.controller.abort();
  const close = () => { void session.handle?.close(); };
  parentSignal?.addEventListener('abort', abort, { once: true });
  session.controller.signal.addEventListener('abort', close, { once: true });
  if (parentSignal?.aborted) abort();
  const cancelExpiry = scheduleExpiry(session, state.clock, state.hasCustomClock);
  try {
    await previous;
    await operation();
  } catch (error) {
    try { sessionFailure(session, error, state.clock.now); }
    catch { session.state = 'failed'; session.message = '登录信息保存失败，请重试'; }
  } finally {
    cancelExpiry();
    parentSignal?.removeEventListener('abort', abort);
    session.controller.signal.removeEventListener('abort', close);
    await session.handle?.close();
    session.qrImage = null;
    session.credential = null;
    session.attempt = null;
    session.handle = session.takeover = null;
    session.finished = true;
    session.clearRetention = scheduleRetention(state.sessions, session, state.clock, state.hasCustomClock);
  }
}

// 同一 key（账号 ID，新增账号统一为 add）的新会话取代旧会话；最多两个 key 同时活跃。
function registerSession(state, fields, { ownerTag, signal }, operation) {
  const active = activeSessions(state.sessions);
  const old = active.filter((session) => session.key === fields.key).at(-1);
  if (new Set(active.filter((session) => session.key !== fields.key).map((session) => session.key)).size >= 2) {
    throw consoleRequestError(429, 'E_CONSOLE_BUSY', '已有两个登录正在进行，请稍后再试');
  }
  old?.controller.abort();
  const session = {
    id: randomBytes(16).toString('base64url'),
    ...fields,
    ownerTag,
    controller: new AbortController(),
    state: 'filling',
    message: null,
    qrImage: null,
    expiresAt: state.clock.now() + SESSION_MS,
  };
  state.sessions.set(session.id, session);
  session.done = runSession(state, session, old?.done, signal, () => operation(session));
  return { session_id: session.id };
}

function startSession(state, slug, { mode, ownerTag, signal } = {}) {
  assertRunning(state.stopping, signal);
  const account = consoleAccount(slug);
  assertStart(account, mode);
  assertDriver(state.driver);
  const deps = { driver: state.driver, seal: state.seal, clock: state.clock, commit: state.commit };
  return registerSession(state, { key: account.id, accountId: account.id, mode }, { ownerTag, signal },
    (session) => withMerchantAuthUpdate(account.id, (tx) => executeSession(session, tx, account, deps), {
      recoveryMallId: account.identity,
      deadlineAt: session.deadlineAt,
      signal: session.controller.signal,
      seal: state.seal,
      clock: state.clock,
    }));
}

// 新增账号：凭据只留在会话内存里直到会话结束，请求体字段用完即删。
function startAddSession(state, body, { ownerTag, signal } = {}) {
  try {
    assertRunning(state.stopping, signal);
    const credential = assertPasswordCredential({ loginName: body?.login_name, password: body?.password });
    assertDriver(state.driver);
    const deps = { driver: state.driver, seal: state.seal, clock: state.clock };
    return registerSession(state, { key: 'add', accountId: null, mode: 'add', credential }, { ownerTag, signal },
      (session) => executeAddSession(session, deps));
  } finally {
    if (body && typeof body === 'object') { delete body.login_name; delete body.password; }
  }
}

async function submitSms(sessions, id, body) {
  const session = interactiveSession(sessions, id, 'sms');
  const code = validateSmsCode(body?.code);
  if (session.submitting) throw consoleRequestError(409, 'E_CONSOLE_SESSION_STATE', '验证码正在提交，请稍候');
  session.submitting = true;
  try {
    const result = await session.handle.submitSmsCode(code);
    return { ok: true, result: result.outcome };
  } finally {
    session.submitting = false;
  }
}

async function submitText(sessions, id, body) {
  const session = interactiveSession(sessions, id, 'takeover');
  const hasText = body && Object.hasOwn(body, 'text');
  const hasKey = body && Object.hasOwn(body, 'key');
  if (!!hasText === !!hasKey) throw invalidTakeoverInput();
  if (hasText) await session.takeover.insertText(body.text);
  else await session.takeover.pressKey(body.key);
  return { ok: true };
}

async function closeAllSessions(state) {
  state.stopping = true;
  const current = [...state.sessions.values()];
  for (const session of current) session.controller.abort();
  await Promise.all(current.map((session) => session.done));
  for (const session of current) session.clearRetention?.();
  state.sessions.clear();
}

/**
 * Create an instance-scoped console application owning the login session registry,
 * P4 state machine, and console account/patrol/auth/health namespaces.
 */
export function createConsoleApp({
  driver = null,
  seal = createCandidateSeal(),
  clock,
  commit,
  patrol = null,
  runtimeConfig = null,
} = {}) {
  const state = {
    sessions: new Map(),
    stopping: false,
    driver,
    seal,
    clock: resolveClock(clock),
    hasCustomClock: clock != null && typeof clock.sleep === 'function',
    commit: commit ?? ((candidate, draft) => saveMerchantLogin({ candidate, identity: candidate.identity }, draft, draft)),
  };

  return Object.freeze({
    health: Object.freeze({
      check: () => consoleHealth(),
    }),
    auth: Object.freeze({
      redeem: (token) => redeemConsoleToken(token),
      resolveSession: (sessionValue) => resolveConsoleSession(sessionValue),
      sessionCookie: (sessionValue, config = runtimeConfig) => consoleSessionCookie(sessionValue, config),
    }),
    patrol: Object.freeze({
      get: (patrolArg = patrol, configArg = runtimeConfig) => getConsolePatrol(patrolArg, configArg),
      set: (patrolArg = patrol, body, configArg = runtimeConfig) => setConsolePatrol(patrolArg, body, configArg),
    }),
    accounts: Object.freeze({
      list: () => listConsoleAccounts(),
      add: (body, options) => startAddSession(state, body, options),
      savePassword: (slug, body) => saveConsolePassword(slug, body),
      clearPassword: (slug) => clearConsolePassword(slug),
      unblock: (slug) => unblockConsoleAccount(slug),
      remove: (slug, body) => removeConsoleAccount(slug, body, {
        isAccountLoggingIn: (accountId) => activeSessions(state.sessions).some((session) => session.accountId === accountId),
      }),
    }),
    sessions: Object.freeze({
      start: (slug, options) => startSession(state, slug, options),
      startAdd: (body, options) => startAddSession(state, body, options),
      get: (id) => formatSessionStatus(findSession(state.sessions, id), state.clock.now),
      frames: (id) => {
        const session = interactiveSession(state.sessions, id, 'takeover');
        if (!session.takeover) throw consoleRequestError(409, 'E_CONSOLE_SESSION_STATE', '验证码画面正在准备，请稍后重试');
        return session.takeover.frames;
      },
      pointer: async (id, body) => {
        const session = interactiveSession(state.sessions, id, 'takeover');
        const { editable, numeric, result } = await session.takeover.dispatchPointer(body?.events, body);
        return { ok: true, editable, numeric, ...(result === 'interrupted' ? { result } : {}) };
      },
      sms: (id, body) => submitSms(state.sessions, id, body),
      text: (id, body) => submitText(state.sessions, id, body),
      refreshQr: async (id) => {
        const session = interactiveSession(state.sessions, id, 'qr');
        if (session.refreshing) throw consoleRequestError(409, 'E_CONSOLE_SESSION_STATE', '二维码正在刷新');
        await refreshQrImage(session, state.clock);
        return { ok: true };
      },
      cancel: async (id) => {
        const session = findSession(state.sessions, id);
        if (!TERMINAL_STATES.has(session.state)) session.controller.abort();
        await session.done;
        return { ok: true };
      },
      awaitDone: async (id) => { await findSession(state.sessions, id).done; },
      closeAll: () => closeAllSessions(state),
    }),
  });
}
