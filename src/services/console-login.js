import { randomBytes } from 'node:crypto';
import { withMerchantAuthUpdate, assertAuthTask } from '../adapter/merchant-auth-storage.js';
import { isMockEnabled, mockPasswordLogin } from '../adapter/mock-dispatcher.js';
import { FIXTURE_QR_IMAGE, openFixtureTakeover } from '../adapter/console-login-fixture.js';
import { invalidTakeoverInput, validateSmsCode } from '../adapter/takeover.js';
import { findAccountByIdentity } from '../infra/account-store.js';
import { assertPasswordCredential } from '../adapter/password-credential.js';
import { abortableSleep } from '../infra/abort.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { consoleAccount } from './console-accounts.js';
import { removeAccountView } from './account-removal.js';
import { consoleRequestError } from './console-runtime.js';
import { saveMerchantLogin, provisionMerchantLogin } from './auth-account-storage.js';
import { decideRelogin, beginReloginAttempt, recordTakeoverTimeout, setAccountPassword } from './password-relogin.js';
import { createFixtureReloginContext } from '../adapter/fixtures/auth.js';
import { verifyMerchantContext, assertMerchantVerified } from '../adapter/merchant-auth.js';
import { openConsoleBrowser, attemptConsolePassword, captureConsoleQr, openConsoleTakeover,
  consoleHasPassId, verifyConsoleLogin, closeConsoleBrowser, submitConsoleSms } from './console-login-browser.js';

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

export const consoleFixtureEnabled = isMockEnabled;

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

// 同一 key（账号 ID，新增账号统一为 add）的新会话取代旧会话；最多两个 key 同时活跃。
function registerSession(fields, { ownerTag, signal }, operation) {
  const active = activeSessions();
  const old = active.filter((session) => session.key === fields.key).at(-1);
  if (new Set(active.filter((session) => session.key !== fields.key).map((session) => session.key)).size >= 2) {
    throw consoleRequestError(429, 'E_CONSOLE_BUSY', '已有两个登录正在进行，请稍后再试');
  }
  old?.controller.abort();
  const session = { id: randomBytes(16).toString('base64url'), ...fields, ownerTag,
    controller: new AbortController(), state: 'filling', message: null, qrImage: null,
    expiresAt: Date.now() + SESSION_MS, fixture: isMockEnabled() };
  sessions.set(session.id, session);
  session.done = runSession(session, old?.done, signal, () => operation(session));
  return { session_id: session.id };
}

export function startConsoleSession(slug, { mode, ownerTag, signal } = {}) {
  assertRunning(signal);
  const account = consoleAccount(slug);
  assertStart(account, mode);
  return registerSession({ key: account.id, accountId: account.id, mode }, { ownerTag, signal },
    (session) => withMerchantAuthUpdate(account.id, (tx) => executeSession(session, tx, account), {
      recoveryMallId: account.identity, deadlineAt: session.deadlineAt, signal: session.controller.signal,
    }));
}

// 新增账号：凭据只留在会话内存里直到会话结束，请求体字段用完即删。
export function startConsoleAddSession(body, { ownerTag, signal } = {}) {
  try {
    assertRunning(signal);
    const credential = assertPasswordCredential({ loginName: body?.login_name, password: body?.password });
    return registerSession({ key: 'add', accountId: null, mode: 'add', credential }, { ownerTag, signal }, executeAddSession);
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

async function beginPassword(session, tx) {
  const decision = decideRelogin(tx.accountId, { manual: true, decrypt: false });
  if (decision.action === 'fail') throw decision.error;
  session.attempt = consoleReloginAttempt(session, tx, decision);
  const outcome = session.fixture ? await mockPasswordLogin({ ...tx, deadlineAt: Date.now() + 70_000 })
    : await attemptConsolePassword(session, tx);
  assertAuthTask(tx);
  if (outcome.outcome === 'success') return true;
  // 只有挑战需要人：短信走输入框，其余挑战转播验证码弹窗；表单变化、网络错误等按结果码结束。
  try { session.attempt.fail(outcome); }
  catch (error) {
    if (outcome.outcome !== 'challenge' || error.code !== 'E_AUTH_HUMAN_REQUIRED') throw error;
  }
  await awaitHuman(session, outcome.challenge);
  return false;
}

async function awaitHuman(session, challenge) {
  if (challenge === 'sms') return setWindow(session, 'sms', TAKEOVER_MS);
  if (session.fixture) session.takeover = openFixtureTakeover();
  else await openConsoleTakeover(session);
  setWindow(session, 'takeover', TAKEOVER_MS);
}

async function beginQr(session) {
  setWindow(session, 'qr', TIMEOUTS.LOGIN_QR);
  if (session.fixture) session.qrImage = FIXTURE_QR_IMAGE;
  else await refreshQrImage(session);
}

async function waitForLogin(session, tx) {
  while (Date.now() < session.expiresAt) {
    assertAuthTask(tx);
    if (session.fixture && session.completion) return session.completion;
    if (!session.fixture && await consoleHasPassId(session)) return 'success';
    await abortableSleep(Math.min(200, Math.max(1, session.expiresAt - Date.now())), tx.signal);
  }
  return 'timeout';
}

function finishTimeout(session) {
  if (AWAITING_HUMAN.has(session.state) && session.accountId != null) recordTakeoverTimeout(session.accountId);
  session.state = 'timed_out';
  session.message = null;
}

function consoleReloginAttempt(session, tx, decision = {}) {
  return beginReloginAttempt(tx, { ...decision, manual: true, password: session.mode === 'password',
    ...(session.fixture ? {} : {
      commit: (candidate, draft) => saveMerchantLogin({ candidate, identity: candidate.identity }, draft, draft),
    }) });
}

async function commitLogin(session, tx) {
  session.state = 'verifying';
  session.message = null;
  session.qrImage = null;
  const result = session.fixture
    ? await verifyMerchantContext(createFixtureReloginContext(tx.recoveryMallId), { ...tx, expectedMallId: tx.recoveryMallId })
    : await verifyConsoleLogin(session, tx);
  assertMerchantVerified(result);
  const attempt = session.attempt ?? consoleReloginAttempt(session, tx);
  attempt.succeed(result.candidate);
  session.state = 'succeeded';
  session.message = null;
}

async function executeSession(session, tx, account) {
  assertStart(account, session.mode);
  assertAuthTask(tx);
  if (!session.fixture) await openConsoleBrowser(session, tx);
  let acquired = false;
  if (session.mode === 'qr') await beginQr(session);
  else acquired = await beginPassword(session, tx);
  const outcome = acquired ? 'success' : await waitForLogin(session, tx);
  assertAuthTask(tx);
  if (outcome === 'timeout') finishTimeout(session);
  else await commitLogin(session, tx);
}

// 新增账号不持有账号租约、不写重登状态；登录失败直接结束会话，挑战照常交给人。
async function executeAddSession(session) {
  const task = { signal: session.controller.signal, deadlineAt: session.deadlineAt };
  if (!session.fixture) await openConsoleBrowser(session, task, EMPTY_STATE);
  const attempt = session.fixture ? await mockPasswordLogin({ ...task, deadlineAt: Date.now() + 70_000 })
    : await attemptConsolePassword(session, task, session.credential);
  assertAuthTask(task);
  if (!['success', 'challenge'].includes(attempt.outcome)) {
    session.state = 'failed';
    session.message = ADD_FAILURES[attempt.outcome] ?? '登录未完成，请重试';
    return;
  }
  if (attempt.outcome === 'challenge') await awaitHuman(session, attempt.challenge);
  const outcome = attempt.outcome === 'success' ? 'success' : await waitForLogin(session, task);
  assertAuthTask(task);
  if (outcome === 'timeout') return finishTimeout(session);
  await commitAddedAccount(session, task);
}

// 店铺已登记时更新其登录状态（短租约），否则新建账号；两种情况都保存这次验证过的密码。
async function commitAddedAccount(session, task) {
  session.state = 'verifying';
  session.message = null;
  const result = await verifyConsoleLogin(session, task);
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
  const close = () => { void closeConsoleBrowser(session); };
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
    await closeConsoleBrowser(session);
    session.qrImage = null;
    session.credential = null;
    session.attempt = null;
    session.browser = session.context = session.page = session.takeover = null;
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
    const result = session.fixture ? { outcome: 'submitted' } : await submitConsoleSms(session, code);
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

async function refreshQrImage(session) {
  const capture = session.fixture ? Promise.resolve() : captureConsoleQr(session);
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

export async function completeFixtureConsoleSession(id, body) {
  if (!isMockEnabled()) throw consoleRequestError(404, 'E_NOT_FOUND', '接口不存在');
  const session = findSession(id);
  if (!session.fixture || !['takeover', 'sms', 'qr'].includes(session.state)) throw consoleRequestError(409, 'E_CONSOLE_SESSION_STATE', '登录状态已变化');
  if (!['success', 'timeout'].includes(body?.outcome)) throw invalidTakeoverInput();
  session.completion = body.outcome;
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
