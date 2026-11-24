import { randomBytes } from 'node:crypto';
import { withMerchantAuthUpdate, commitMerchantCandidate } from '../adapter/merchant-auth-storage.js';
import { assertAuthTask, assertMerchantVerified } from '../infra/auth-task.js';
import { createCandidateSeal } from '../infra/candidate-seal.js';
import { invalidTakeoverInput, validateSmsCode } from '../adapter/takeover.js';
import { findAccountByIdentity } from '../infra/account-store.js';
import { assertPasswordCredential, loadPasswordCredential } from '../adapter/password-credential.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { consoleAccount } from './console-accounts.js';
import { removeAccountView } from './account-removal.js';
import { consoleRequestError } from './console-runtime.js';
import { saveMerchantLogin, provisionMerchantLogin } from './auth-account-storage.js';
import {
  decideRelogin,
  beginReloginAttempt,
  recordTakeoverTimeout,
  setAccountPassword,
  extractDeviceState,
} from './relogin-policy.js';

const sessions = new Map();
const terminal = new Set(['succeeded', 'failed', 'timed_out', 'cancelled']);
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

function activeSessions() {
  return [...sessions.values()].filter((session) => !session.finished);
}

// 输入店铺名才删除；正在登录的店铺先取消登录，避免会话写回已删除的账号。
export function removeConsoleAccount(slug, body) {
  const account = consoleAccount(slug);
  const expected = account.display_name ?? account.slug;
  if (typeof body?.confirm_name !== 'string' || body.confirm_name.trim() !== expected) {
    throw consoleRequestError(400, 'E_USAGE', '店铺名不一致，未删除');
  }
  if (activeSessions().some((session) => session.accountId === account.id)) {
    throw consoleRequestError(409, 'E_CONSOLE_SESSION_STATE', '该店铺正在登录，请先取消登录');
  }
  removeAccountView(account.slug, { confirm: true });
  return { ok: true, removed: true };
}

function assertRunning(signal) {
  if (signal?.aborted) throw consoleRequestError(503, 'E_CONSOLE_STOPPING', '控制台正在停止，请稍后重新打开');
}

function createLegacyBrowserBridge(browserMod) {
  return {
    async openSession({ ownerTag, storageState } = {}) {
      const { browser, context: launchedContext } = await browserMod.launchBrowser({ ownerTag });
      let context = null;
      let page = null;
      try {
        await launchedContext?.close();
        context = await browserMod.createSnapshotContext(browser, storageState);
        page = await context.newPage();
      } catch (error) {
        try { await page?.close(); } catch { /* ignore */ }
        try { await context?.close(); } catch { /* ignore */ }
        try { await browser?.close(); } catch { /* ignore */ }
        throw error;
      }
      return {
        page,
        context,
        createSnapshotContext: (snapshot) => browserMod.createSnapshotContext(browser, snapshot),
        close: async () => { await browser?.close(); },
      };
    },
  };
}

async function resolveConsoleDriver(session) {
  if (session.runtime?.ports?.consoleLoginDriver) {
    return session.runtime.ports.consoleLoginDriver;
  }
  if (session.runtime?.mode === 'fixture') {
    const rt = session.runtime;
    const authPort = typeof rt.ports?.auth?.verifyAndSeal === 'function'
      ? rt.ports.auth
      : {
          verifyAndSeal: async (target, opts) => {
            const verifyFn = rt.fixture?.verifyFixtureMerchantContext
              ?? (await import('../adapter/fixtures/auth.js')).verifyFixtureMerchantContext;
            return verifyFn(target, opts);
          },
        };
    const { createFixtureConsoleLoginDriver } = await import('../adapter/console-login-fixture.js');
    return createFixtureConsoleLoginDriver({
      authPort,
      seal: session.seal,
      clock: rt.clock,
      parsedEnv: rt.env,
      mockPasswordLoginFn: rt.fixture?.mockPasswordLogin,
      createReloginContextFn: rt.fixture?.createFixtureReloginContext,
    });
  }
  const browserMod = await import('../adapter/browser.js');
  const browserRuntime = Object.hasOwn(browserMod, 'createLiveBrowserRuntime')
    ? browserMod.createLiveBrowserRuntime()
    : createLegacyBrowserBridge(browserMod);
  const { createLiveAuthPort } = await import('../adapter/auth-port.js');
  const { createLiveConsoleLoginDriver } = await import('../adapter/console-login-driver.js');
  const authPort = session.runtime?.ports?.auth
    ?? createLiveAuthPort({ seal: session.seal, now: session.runtime?.clock?.now });
  return createLiveConsoleLoginDriver({
    browserRuntime,
    authPort,
    seal: session.seal,
    clock: session.runtime?.clock,
  });
}

// 同一 key（账号 ID，新增账号统一为 add）的新会话取代旧会话；最多两个 key 同时活跃。
function registerSession(fields, { ownerTag, signal, runtime }, operation) {
  const active = activeSessions();
  const old = active.filter((session) => session.key === fields.key).at(-1);
  if (new Set(active.filter((session) => session.key !== fields.key).map((session) => session.key)).size >= 2) {
    throw consoleRequestError(429, 'E_CONSOLE_BUSY', '已有两个登录正在进行，请稍后再试');
  }
  old?.controller.abort();
  const nowFn = runtime?.clock?.now ?? Date.now;
  const seal = runtime?.seal ?? createCandidateSeal();
  const session = {
    id: randomBytes(16).toString('base64url'),
    ...fields,
    ownerTag,
    controller: new AbortController(),
    state: 'filling',
    message: null,
    qrImage: null,
    expiresAt: nowFn() + SESSION_MS,
    fixture: runtime?.mode === 'fixture',
    runtime,
    seal,
  };
  sessions.set(session.id, session);
  session.done = runSession(session, old?.done, signal, () => operation(session));
  return { session_id: session.id };
}

export function startConsoleSession(slug, { mode, ownerTag, signal, runtime } = {}) {
  assertRunning(signal);
  const account = consoleAccount(slug);
  assertStart(account, mode);
  return registerSession({ key: account.id, accountId: account.id, mode }, { ownerTag, signal, runtime },
    (session) => withMerchantAuthUpdate(account.id, (tx) => executeSession(session, tx, account), {
      recoveryMallId: account.identity, deadlineAt: session.deadlineAt, signal: session.controller.signal,
      seal: session.seal, clock: runtime?.clock,
    }));
}

// 新增账号：凭据只留在会话内存里直到会话结束，请求体字段用完即删。
export function startConsoleAddSession(body, { ownerTag, signal, runtime } = {}) {
  try {
    assertRunning(signal);
    const credential = assertPasswordCredential({ loginName: body?.login_name, password: body?.password });
    return registerSession({ key: 'add', accountId: null, mode: 'add', credential }, { ownerTag, signal, runtime }, executeAddSession);
  } finally {
    if (body && typeof body === 'object') { delete body.login_name; delete body.password; }
  }
}

function setWindow(session, state, duration) {
  assertAuthTask({ signal: session.controller.signal });
  session.state = state;
  session.expiresAt = Math.min(session.deadlineAt, Date.now() + duration);
  session.message = state === 'sms' ? '短信验证码已发送到绑定手机' : null;
}

async function openDriverSession(session, deviceState) {
  const driver = await resolveConsoleDriver(session);
  session.driver = driver;
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

async function beginPassword(session, tx, handle) {
  const decision = decideRelogin(tx.accountId, { manual: true, decrypt: false });
  if (decision.action === 'fail') throw decision.error;
  session.attempt = consoleReloginAttempt(session, tx, decision);
  const credential = loadPasswordCredential(tx.accountId);
  const outcome = await handle.attemptPassword(credential, {
    signal: tx.signal,
    deadlineAt: Math.min(session.deadlineAt, (session.runtime?.clock?.now?.() ?? Date.now()) + 70_000),
  });
  assertAuthTask(tx);
  if (outcome.outcome === 'success') return true;
  // 只有挑战需要人：短信走输入框，其余挑战转播验证码弹窗；表单变化、网络错误等按结果码结束。
  try { session.attempt.fail(outcome); }
  catch (error) {
    if (outcome.outcome !== 'challenge' || error.code !== 'E_AUTH_HUMAN_REQUIRED') throw error;
  }
  await awaitHuman(session, handle, outcome.challenge);
  return false;
}

async function awaitHuman(session, handle, challenge) {
  if (challenge === 'sms') return setWindow(session, 'sms', TAKEOVER_MS);
  session.takeover = await handle.openTakeover();
  setWindow(session, 'takeover', TAKEOVER_MS);
}

async function beginQr(session, handle) {
  setWindow(session, 'qr', TIMEOUTS.LOGIN_QR);
  await refreshQrImage(session, handle);
}

function finishTimeout(session) {
  if (AWAITING_HUMAN.has(session.state) && session.accountId != null) recordTakeoverTimeout(session.accountId);
  session.state = 'timed_out';
  session.message = null;
}

function consoleReloginAttempt(session, tx, decision = {}) {
  const seal = tx?.seal ?? session.seal;
  return beginReloginAttempt(tx, {
    ...decision,
    manual: true,
    password: session.mode === 'password',
    seal,
    commit: session.fixture
      ? commitMerchantCandidate
      : (candidate, draft) => saveMerchantLogin({ candidate, identity: candidate.identity }, draft, draft),
  });
}

async function commitLogin(session, tx, handle) {
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
  const attempt = session.attempt ?? consoleReloginAttempt(session, tx);
  attempt.succeed(result.candidate);
  session.state = 'succeeded';
  session.message = null;
}

async function executeSession(session, tx, account) {
  assertStart(account, session.mode);
  assertAuthTask(tx);
  const handle = await openDriverSession(session, extractDeviceState(tx));
  let acquired = false;
  if (session.mode === 'qr') await beginQr(session, handle);
  else acquired = await beginPassword(session, tx, handle);
  const outcome = acquired
    ? 'success'
    : await handle.waitForAcquisition({ signal: tx.signal, expiresAt: session.expiresAt });
  assertAuthTask(tx);
  if (outcome === 'timeout') finishTimeout(session);
  else await commitLogin(session, tx, handle);
}

// 新增账号不持有账号租约、不写重登状态；登录失败直接结束会话，挑战照常交给人。
async function executeAddSession(session) {
  const task = {
    signal: session.controller.signal,
    deadlineAt: session.deadlineAt,
    seal: session.seal,
    ...(session.runtime?.clock ? { clock: session.runtime.clock } : {}),
  };
  const handle = await openDriverSession(session, EMPTY_STATE);
  const attempt = await handle.attemptPassword(session.credential, {
    signal: task.signal,
    deadlineAt: Math.min(task.deadlineAt, (session.runtime?.clock?.now?.() ?? Date.now()) + 70_000),
  });
  assertAuthTask(task);
  if (!['success', 'challenge'].includes(attempt.outcome)) {
    session.state = 'failed';
    session.message = ADD_FAILURES[attempt.outcome] ?? '登录未完成，请重试';
    return;
  }
  if (attempt.outcome === 'challenge') await awaitHuman(session, handle, attempt.challenge);
  const outcome = attempt.outcome === 'success'
    ? 'success'
    : await handle.waitForAcquisition({ signal: task.signal, expiresAt: session.expiresAt });
  assertAuthTask(task);
  if (outcome === 'timeout') return finishTimeout(session);
  await commitAddedAccount(session, task, handle);
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

function sessionFailure(session, error) {
  if (session.controller.signal.aborted || Date.now() >= session.expiresAt) {
    if (session.expired || !session.controller.signal.aborted) finishTimeout(session);
    else { session.state = 'cancelled'; session.message = null; }
    return;
  }
  session.state = 'failed';
  const messages = { E_ACCOUNT_IDENTITY_MISMATCH: '登录店铺与所选店铺不一致，未保存',
    E_AUTH_RELOGIN_BLOCKED: '自动登录已暂停，请修改密码或扫码登录',
    E_AUTH_EXPIRED: '核验未通过，请重新登录',
    E_PASSWORD_LOGIN_FORM_CHANGED: '自动填写失败，请扫码登录',
    E_AUTH_RELOGIN_FAILED: '登录未完成，请重试或扫码登录' };
  session.message = messages[error?.code] ?? '登录未完成，请重试';
}

async function runSession(session, previous, parentSignal, operation) {
  session.deadlineAt = session.expiresAt;
  const abort = () => session.controller.abort();
  const close = () => { void session.handle?.close(); };
  parentSignal?.addEventListener('abort', abort, { once: true });
  session.controller.signal.addEventListener('abort', close, { once: true });
  if (parentSignal?.aborted) abort();
  const timer = setTimeout(() => { session.expired = true; session.controller.abort(); }, SESSION_MS);
  try {
    await previous;
    await operation();
  } catch (error) {
    try { sessionFailure(session, error); }
    catch { session.state = 'failed'; session.message = '登录信息保存失败，请重试'; }
  }
  finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abort);
    session.controller.signal.removeEventListener('abort', close);
    await session.handle?.close();
    session.qrImage = null;
    session.credential = null;
    session.attempt = null;
    session.handle = session.driver = session.takeover = null;
    session.finished = true;
    session.retention = setTimeout(() => sessions.delete(session.id), RETENTION_MS);
    session.retention.unref?.();
  }
}

function findSession(id) {
  const session = sessions.get(id);
  if (!session) throw consoleRequestError(404, 'E_CONSOLE_SESSION_NOT_FOUND', '登录已结束或不存在');
  return session;
}

function interactiveSession(id, state) {
  const session = findSession(id);
  if (session.state !== state || session.controller.signal.aborted) {
    throw consoleRequestError(409, 'E_CONSOLE_SESSION_STATE', '登录状态已变化，请刷新页面');
  }
  return session;
}

export function getConsoleSession(id) {
  const session = findSession(id);
  return { state: session.state, message: session.message,
    remaining_seconds: terminal.has(session.state) ? 0 : Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 1000)),
    expires_at: new Date(session.expiresAt).toISOString(), qr_image: session.state === 'qr' ? session.qrImage : null };
}

export function consoleSessionFrames(id) {
  const session = interactiveSession(id, 'takeover');
  if (!session.takeover) throw consoleRequestError(409, 'E_CONSOLE_SESSION_STATE', '验证码画面正在准备，请稍后重试');
  return session.takeover.frames;
}

export async function consoleSessionPointer(id, body) {
  const session = interactiveSession(id, 'takeover');
  const { editable, numeric, result } = await session.takeover.dispatchPointer(body?.events, body);
  return { ok: true, editable, numeric, ...(result === 'interrupted' ? { result } : {}) };
}

// result: submitted | wrong_code | form_changed；登录是否完成由会话轮询 PASS_ID 决定。
export async function consoleSessionSms(id, body) {
  const session = interactiveSession(id, 'sms');
  const code = validateSmsCode(body?.code);
  if (session.submitting) throw consoleRequestError(409, 'E_CONSOLE_SESSION_STATE', '验证码正在提交，请稍候');
  session.submitting = true;
  try {
    const result = await session.handle.submitSmsCode(code);
    return { ok: true, result: result.outcome };
  } finally { session.submitting = false; }
}

export async function consoleSessionText(id, body) {
  const session = interactiveSession(id, 'takeover');
  const text = body && Object.hasOwn(body, 'text');
  const key = body && Object.hasOwn(body, 'key');
  if (!!text === !!key) throw invalidTakeoverInput();
  if (text) await session.takeover.insertText(body.text);
  else await session.takeover.pressKey(body.key);
  return { ok: true };
}

export async function refreshConsoleQr(id) {
  const session = interactiveSession(id, 'qr');
  if (session.refreshing) throw consoleRequestError(409, 'E_CONSOLE_SESSION_STATE', '二维码正在刷新');
  await refreshQrImage(session);
  return { ok: true };
}

async function refreshQrImage(session, handle = session.handle) {
  const capture = (async () => {
    const qrImage = await handle.captureQr();
    assertAuthTask({ signal: session.controller.signal, deadlineAt: session.expiresAt });
    session.qrImage = qrImage;
  })();
  session.refreshing = capture;
  try {
    await capture;
  } finally { session.refreshing = null; }
}

export async function cancelConsoleSession(id) {
  const session = findSession(id);
  if (!terminal.has(session.state)) session.controller.abort();
  await session.done;
  return { ok: true };
}

export async function completeFixtureConsoleSession(id, body, runtime) {
  if (runtime?.mode !== 'fixture') throw consoleRequestError(404, 'E_NOT_FOUND', '接口不存在');
  const session = findSession(id);
  if (!session.fixture || !['takeover', 'sms', 'qr'].includes(session.state)) {
    throw consoleRequestError(409, 'E_CONSOLE_SESSION_STATE', '登录状态已变化');
  }
  if (!['success', 'timeout'].includes(body?.outcome)) throw invalidTakeoverInput();
  const driver = runtime?.ports?.consoleLoginDriver ?? session.driver;
  if (typeof driver?.completeSession !== 'function') {
    throw consoleRequestError(409, 'E_CONSOLE_SESSION_STATE', '登录状态已变化');
  }
  driver.completeSession(id, body.outcome);
  await session.done;
  return { ok: true };
}

export async function closeAllConsoleSessions() {
  const current = [...sessions.values()];
  for (const session of current) session.controller.abort();
  await Promise.all(current.map((session) => session.done));
  for (const session of current) clearTimeout(session.retention);
  sessions.clear();
}
