import { randomBytes } from 'node:crypto';
import { withMerchantAuthUpdate, assertAuthTask } from '../adapter/merchant-auth-storage.js';
import { isMockEnabled, mockPasswordLogin } from '../adapter/mock-dispatcher.js';
import { FIXTURE_QR_IMAGE, openFixtureTakeover } from '../adapter/console-login-fixture.js';
import { invalidTakeoverInput, validateSmsCode } from '../adapter/takeover.js';
import { getCredential } from '../infra/account-store.js';
import { transaction } from '../infra/db.js';
import { abortableSleep } from '../infra/abort.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { getMasterKey } from '../infra/master-key.js';
import { consoleAccount } from './console-accounts.js';
import { consoleRequestError } from './console-runtime.js';
import { saveMerchantLogin } from './auth-account-storage.js';
import { getReloginSummary, recordReloginAttempt, recordReloginOutcome, recordTakeoverTimeout,
  markManualLoginSucceeded, commitFixtureRelogin } from './password-relogin.js';
import { openConsoleBrowser, attemptConsolePassword, captureConsoleQr, openConsoleTakeover,
  consoleHasPassId, verifyConsoleLogin, closeConsoleBrowser, submitConsoleSms } from './console-login-browser.js';

const sessions = new Map();
const terminal = new Set(['succeeded', 'failed', 'timed_out', 'cancelled']);
const TAKEOVER_MS = 600_000;
const SESSION_MS = 720_000;
const RETENTION_MS = 300_000;
const AWAITING_HUMAN = new Set(['takeover', 'sms']);

export const consoleFixtureEnabled = isMockEnabled;

function assertStart(account, mode) {
  const summary = getReloginSummary(account.id);
  if (summary.status === 'blocked') throw consoleRequestError(409, 'E_AUTH_RELOGIN_BLOCKED', '账号自动重登已熔断，请先解除熔断或重设密码');
  if (!['password', 'qr'].includes(mode)) throw invalidTakeoverInput();
  if (mode === 'password' && !summary.has_password) throw consoleRequestError(409, 'E_AUTH_PASSWORD_REQUIRED', '请先保存账号密码');
}

function activeSessions() {
  return [...sessions.values()].filter((session) => !session.finished);
}

export function startConsoleSession(slug, { mode, ownerTag, signal } = {}) {
  if (signal?.aborted) throw consoleRequestError(503, 'E_CONSOLE_STOPPING', '控制台正在停止，请稍后重新打开');
  const account = consoleAccount(slug);
  assertStart(account, mode);
  const active = activeSessions();
  const old = active.filter((session) => session.accountId === account.id).at(-1);
  if (new Set(active.filter((session) => session.accountId !== account.id).map((session) => session.accountId)).size >= 2) {
    throw consoleRequestError(429, 'E_CONSOLE_BUSY', '已有两个登录会话，请稍后再试');
  }
  old?.controller.abort();
  const session = { id: randomBytes(16).toString('base64url'), accountId: account.id, mode, ownerTag,
    controller: new AbortController(), state: 'filling', message: null, qrImage: null,
    expiresAt: Date.now() + SESSION_MS, fixture: isMockEnabled() };
  sessions.set(session.id, session);
  session.done = runSession(session, account, old?.done, signal);
  return { session_id: session.id };
}

function setWindow(session, state, duration) {
  assertAuthTask({ signal: session.controller.signal });
  session.state = state;
  session.expiresAt = Math.min(session.deadlineAt, Date.now() + duration);
  if (state === 'takeover') session.message = '请在下方验证码弹窗中完成验证';
  if (state === 'sms') session.message = '登录页已向绑定手机发送短信验证码，请在下方输入';
}

async function beginPassword(session, tx) {
  session.credentialUpdatedAt = getCredential(tx.accountId)?.updated_at;
  recordReloginAttempt(tx);
  const outcome = session.fixture ? await mockPasswordLogin({ ...tx, deadlineAt: Date.now() + 70_000 })
    : await attemptConsolePassword(session, tx);
  assertAuthTask(tx);
  if (outcome.outcome === 'success') return true;
  // 只有挑战需要人：短信走输入框，其余挑战转播验证码弹窗；表单变化、网络错误等按结果码结束。
  const error = recordReloginOutcome(tx, outcome, session);
  if (outcome.outcome !== 'challenge') throw error;
  if (outcome.challenge === 'sms') setWindow(session, 'sms', TAKEOVER_MS);
  else await beginTakeover(session);
  return false;
}

async function beginTakeover(session) {
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
  if (AWAITING_HUMAN.has(session.state)) recordTakeoverTimeout(session.accountId);
  session.state = 'timed_out';
  session.message = '登录等待超时，请重新开始';
}

async function commitLogin(session, tx) {
  session.state = 'verifying';
  session.qrImage = null;
  if (session.fixture) {
    getMasterKey();
    transaction(() => {
      commitFixtureRelogin(tx, tx);
      markManualLoginSucceeded(tx.accountId);
      if (session.mode === 'password') recordReloginOutcome(tx, 'success', session);
    });
  } else {
    const result = await verifyConsoleLogin(session, tx);
    saveMerchantLogin(result, tx, tx);
    if (session.mode === 'password') recordReloginOutcome(tx, 'success', session);
  }
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

function sessionFailure(session, error) {
  if (session.controller.signal.aborted || Date.now() >= session.expiresAt) {
    if (session.expired || !session.controller.signal.aborted) finishTimeout(session);
    else { session.state = 'cancelled'; session.message = null; }
    return;
  }
  session.state = 'failed';
  const messages = { E_ACCOUNT_IDENTITY_MISMATCH: 'E_ACCOUNT_IDENTITY_MISMATCH：登录店铺与账号绑定不一致，未保存',
    E_AUTH_RELOGIN_BLOCKED: '账号自动重登已熔断，请解除熔断或重设密码',
    E_AUTH_EXPIRED: '登录核验未通过，请重新登录',
    E_PASSWORD_LOGIN_FORM_CHANGED: '登录页结构已变化，自动填写失败，请改用扫码登录',
    E_AUTH_RELOGIN_FAILED: '登录过程中网络异常，请稍后重试或改用扫码登录' };
  session.message = messages[error?.code] ?? '登录未完成，请重新开始';
}

async function runSession(session, account, previous, parentSignal) {
  session.deadlineAt = session.expiresAt;
  const abort = () => session.controller.abort();
  const close = () => { void closeConsoleBrowser(session); };
  parentSignal?.addEventListener('abort', abort, { once: true });
  session.controller.signal.addEventListener('abort', close, { once: true });
  if (parentSignal?.aborted) abort();
  const timer = setTimeout(() => { session.expired = true; session.controller.abort(); }, SESSION_MS);
  try {
    await previous;
    await withMerchantAuthUpdate(account.id, (tx) => executeSession(session, tx, account), {
      recoveryMallId: account.identity, deadlineAt: session.deadlineAt, signal: session.controller.signal,
    });
  } catch (error) {
    try { sessionFailure(session, error); }
    catch { session.state = 'failed'; session.message = '登录状态保存失败，请重新开始'; }
  }
  finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abort);
    session.controller.signal.removeEventListener('abort', close);
    await closeConsoleBrowser(session);
    session.qrImage = null;
    session.browser = session.context = session.page = session.takeover = null;
    session.finished = true;
    session.retention = setTimeout(() => sessions.delete(session.id), RETENTION_MS);
    session.retention.unref?.();
  }
}

function findSession(id) {
  const session = sessions.get(id);
  if (!session) throw consoleRequestError(404, 'E_CONSOLE_SESSION_NOT_FOUND', '登录会话已结束或不存在');
  return session;
}

function interactiveSession(id, state) {
  const session = findSession(id);
  if (session.state !== state || session.controller.signal.aborted) {
    throw consoleRequestError(409, 'E_CONSOLE_SESSION_STATE', '当前会话状态已变化，请刷新页面');
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
  if (!session.takeover) throw consoleRequestError(409, 'E_CONSOLE_SESSION_STATE', '接管画面正在准备，请稍后重试');
  return session.takeover.frames;
}

export async function consoleSessionPointer(id, body) {
  const session = interactiveSession(id, 'takeover');
  const { editable, numeric } = await session.takeover.dispatchPointer(body?.events);
  return { ok: true, editable, numeric };
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
  if (!session.fixture || !['takeover', 'sms', 'qr'].includes(session.state)) throw consoleRequestError(409, 'E_CONSOLE_SESSION_STATE', '会话状态已变化');
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
