import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { insertAccount, getAccountById, putReloginState, getReloginState, listPendingActions, listAccounts,
  insertPendingAction } from '../../src/infra/account-store.js';
import { get, run, isInTransaction } from '../../src/infra/db.js';
import { saveAuthStateSnapshot, loadAuthState } from '../../src/adapter/auth-state.js';
import { setAccountPassword, clearAccountPassword } from '../../src/services/password-relogin.js';
import { mockMerchantProbeTransport } from '../helpers/merchant-probe-transport.js';

const control = vi.hoisted(() => ({ contexts: [], browser: null, outcome: { outcome: 'success' }, failAt: null,
  mallId: 900001, login: true, held: null }));

vi.mock('../../src/adapter/browser.js', () => ({
  launchBrowser: vi.fn(async () => {
    if (control.failAt === 'launch') throw new Error('private launch error');
    return { browser: control.browser };
  }),
  createSnapshotContext: vi.fn(async (browser, input) => {
    assert.equal(isInTransaction(), false);
    const state = structuredClone(input);
    const cdp = new EventEmitter();
    cdp.send = vi.fn(async () => {});
    cdp.detach = vi.fn(async () => {});
    const context = { state, browser: () => browser, close: vi.fn(async () => {}),
      cookies: vi.fn(async () => structuredClone(state.cookies)),
      storageState: async () => structuredClone(state), newCDPSession: async () => cdp };
    const page = { context: () => context, close: vi.fn(async () => {}) };
    context.newPage = vi.fn(async () => {
      if (control.failAt === 'page') throw new Error('private page error');
      return page;
    });
    context.page = page;
    control.contexts.push(context);
    if (control.failAt === 'context') throw new Error('private context error');
    return context;
  }),
}));

vi.mock('../../src/adapter/password-login.js', () => ({
  attemptPasswordLogin: vi.fn(async (page, credential, task) => {
    assert.equal(isInTransaction(), false);
    // 重登持有账号租约；新增账号在登记前不持有任何租约。
    assert.equal(Boolean(get("SELECT owner_token FROM leases WHERE scope = 'account'")), !control.adding);
    assert.ok(task.deadlineAt - Date.now() <= 70_000);
    assert.ok(task.deadlineAt - Date.now() > 69_000);
    assert.deepEqual(credential, { loginName: 'private-login', password: 'private-password' });
    if (control.held) await control.held;
    if (control.outcome.outcome === 'success') page.context().state.cookies.push(passCookie());
    return control.outcome;
  }),
  submitSmsCode: vi.fn(async () => control.sms),
}));

vi.mock('../../src/adapter/qr-login.js', () => ({
  captureQrElement: vi.fn(async () => {
    assert.equal(isInTransaction(), false);
    return Buffer.from('fixture-png');
  }),
}));

import { launchBrowser, createSnapshotContext } from '../../src/adapter/browser.js';
import { attemptPasswordLogin, submitSmsCode } from '../../src/adapter/password-login.js';
import { captureQrElement } from '../../src/adapter/qr-login.js';
import { startConsoleSession, getConsoleSession, cancelConsoleSession, refreshConsoleQr,
  closeAllConsoleSessions, completeFixtureConsoleSession, consoleSessionSms, startConsoleAddSession,
  consoleSessionPointer } from '../../src/services/console-login.js';

let account;
let original;

function passCookie() { return { name: 'PASS_ID', value: 'synthetic-pass', domain: '.pinduoduo.com', path: '/', secure: true }; }

beforeEach(() => {
  vi.stubEnv('PDD_TEST_ADAPTER', '');
  control.contexts = [];
  control.browser = { close: vi.fn(async () => {}) };
  control.outcome = { outcome: 'success' };
  control.sms = { outcome: 'submitted' };
  control.adding = false;
  control.failAt = null; control.held = null; control.mallId = 900001; control.login = true;
  account = insertAccount({ identity: '900001', displayName: 'Shop' });
  original = { cookies: [passCookie(), { name: 'device', value: 'trust', domain: '.pinduoduo.com', path: '/' }],
    origins: [{ origin: 'https://mms.pinduoduo.com', localStorage: [{ name: 'device', value: 'trusted' }] }] };
  saveAuthStateSnapshot(original, account.id);
  setAccountPassword(account.id, { loginName: 'private-login', password: 'private-password' });
  mockMerchantProbeTransport(() => ({ mallId: control.mallId, mallName: 'Verified Shop', login: control.login }));
  vi.clearAllMocks();
});

afterEach(async () => { await closeAllConsoleSessions(); });

function start(mode = 'password', options = {}) {
  return startConsoleSession(account.slug, { mode, ownerTag: 'test-daemon', ...options }).session_id;
}

async function stateIs(id, state) {
  await vi.waitFor(() => assert.equal(getConsoleSession(id).state, state), { timeout: 5000, interval: 20 });
  return getConsoleSession(id);
}

function assertReleased() { assert.equal(get("SELECT count(*) AS total FROM leases WHERE scope = 'account'").total, 0); }

it('uses device-continuous state, verifies after closing the page, and saves manual login through the shared path', async () => {
  putReloginState(account.id, { status: 'awaiting_human', reason: 'sms', consecutiveTakeoverTimeouts: 1,
    lastAttemptAt: new Date().toISOString() });
  const id = start();
  await stateIs(id, 'succeeded');
  assert.deepEqual(launchBrowser.mock.calls[0][0], { ownerTag: 'test-daemon' });
  const input = createSnapshotContext.mock.calls[0][1];
  assert.deepEqual(input.cookies, original.cookies.filter((cookie) => cookie.name !== 'PASS_ID'));
  assert.deepEqual(input.origins, original.origins);
  assert.equal(attemptPasswordLogin.mock.calls.length, 1);
  assert.equal(control.contexts[0].page.close.mock.calls.length, 1);
  assert.equal(control.contexts.length, 2);
  assert.equal(control.contexts[1].close.mock.calls.length, 1);
  const saved = loadAuthState(account.id);
  assert.equal(saved.revision, 2);
  assert.equal(saved.metadata.check_verdict, 'verified');
  assert.equal(getReloginState(account.id).consecutive_takeover_timeouts, 0);
  assert.equal(getReloginState(account.id).status, 'available');
  assert.equal(getAccountById(account.id).display_name, 'Verified Shop');
  assert.ok(getAccountById(account.id).last_login_at);
  assert.equal(control.browser.close.mock.calls.length, 1);
  assertReleased();
});

it.each(['wrong_password', 'account_locked'])('records %s and closes the browser without committing', async (outcome) => {
  control.outcome = { outcome };
  const id = start();
  await stateIs(id, 'failed');
  assert.equal(getReloginState(account.id).status, 'blocked');
  assert.equal(getConsoleSession(id).message, '自动登录已暂停，请修改密码或扫码登录');
  assert.equal(getReloginState(account.id).reason, outcome);
  assert.equal(listPendingActions(account.id).filter((action) => action.status === 'open').length, 1);
  assert.equal(loadAuthState(account.id).revision, 1);
  assert.equal(control.browser.close.mock.calls.length, 1);
  assertReleased();
});

it.each(['unknown', 'slider'])('offers captcha takeover for %s challenges and waits for PASS_ID before verification', async (challenge) => {
  control.outcome = { outcome: 'challenge', challenge };
  const id = start();
  const session = await stateIs(id, 'takeover');
  assert.ok(session.remaining_seconds > 590);
  assert.equal(session.message, null);
  assert.equal(loadAuthState(account.id).revision, 1);
  assert.equal(isInTransaction(), false);
  assert.ok(get("SELECT owner_token FROM leases WHERE scope = 'account'"));
  control.contexts[0].state.cookies.push(passCookie());
  await stateIs(id, 'succeeded');
  assert.equal(loadAuthState(account.id).revision, 2);
  assert.equal(listPendingActions(account.id).filter((action) => action.status === 'open').length, 0);
  assertReleased();
});

it('asks for the SMS code without a takeover picture and fills it into the login page', async () => {
  control.outcome = { outcome: 'challenge', challenge: 'sms' };
  const id = start();
  const session = await stateIs(id, 'sms');
  assert.ok(session.remaining_seconds > 590);
  assert.equal(session.message, '短信验证码已发送到绑定手机');
  assert.equal(getReloginState(account.id).status, 'awaiting_human');
  await assert.rejects(consoleSessionPointer(id, { events: [] }), { code: 'E_CONSOLE_SESSION_STATE' });
  for (const code of ['12', '12345a', 123456]) await assert.rejects(consoleSessionSms(id, { code }), { code: 'E_USAGE' });
  assert.equal(submitSmsCode.mock.calls.length, 0);
  control.sms = { outcome: 'wrong_code' };
  assert.deepEqual(await consoleSessionSms(id, { code: '000000' }), { ok: true, result: 'wrong_code' });
  control.sms = { outcome: 'submitted' };
  assert.deepEqual(await consoleSessionSms(id, { code: '123456' }), { ok: true, result: 'submitted' });
  const [page, code, task] = submitSmsCode.mock.calls.at(-1);
  assert.equal(page, control.contexts[0].page);
  assert.equal(code, '123456');
  assert.ok(task.deadlineAt - Date.now() <= 15_000);
  control.contexts[0].state.cookies.push(passCookie());
  await stateIs(id, 'succeeded');
  assert.equal(loadAuthState(account.id).revision, 2);
  assert.equal(getReloginState(account.id).status, 'available');
  assertReleased();
});

it('preserves pointer focus fields and forwards interruption and cancellation in fixture sessions', async () => {
  vi.stubEnv('PDD_TEST_ADAPTER', 'fixture');
  vi.stubEnv('PDD_TEST_PASSWORD_LOGIN', 'challenge:slider');
  const id = start();
  await stateIs(id, 'takeover');
  const events = [{ t: 0, type: 'down', x: 0, y: 0 }];
  await assert.rejects(consoleSessionPointer(id, { events }), { code: 'E_USAGE' });
  assert.deepEqual(await consoleSessionPointer(id, { gesture_id: 'drag', seq: 0, events }),
    { ok: true, editable: null, numeric: null });
  const stopped = { ok: true, editable: null, numeric: null, result: 'interrupted' };
  assert.deepEqual(await consoleSessionPointer(id, { gesture_id: 'drag', seq: 0, events }), stopped);
  assert.deepEqual(await consoleSessionPointer(id, { gesture_id: 'drag', seq: 1, events: [], cancel: true }), stopped);
  assert.deepEqual(await consoleSessionPointer(id, { gesture_id: 'new', seq: 0,
    events: [...events, { ...events[0], type: 'up' }] }), { ok: true, editable: false, numeric: false });
});

it.each(['existing', 'add'])('clears the SMS message while verifying an %s shop', async (mode) => {
  control.outcome = { outcome: 'challenge', challenge: 'sms' };
  if (mode === 'add') control.mallId = 900099;
  const id = mode === 'add' ? startAdd() : start();
  const sms = await stateIs(id, 'sms');
  assert.equal(sms.message, '短信验证码已发送到绑定手机');
  let release;
  const closing = new Promise((resolve) => { release = resolve; });
  control.contexts[0].page.close.mockImplementation(async () => { await closing; });
  try {
    control.contexts[0].state.cookies.push(passCookie());
    const verifying = await stateIs(id, 'verifying');
    assert.equal(verifying.message, null);
    assert.equal(loadAuthState(account.id).revision, 1);
    assert.equal(listAccounts().length, 1);
  } finally { release(); }
  const succeeded = await stateIs(id, 'succeeded');
  assert.equal(succeeded.message, mode === 'add' ? '店铺已添加，密码已保存' : null);
  assertReleased();
});

it.each([['form_changed', '自动填写失败，请扫码登录'],
  ['network_error', '登录未完成，请重试或扫码登录']])('ends %s by its result code without takeover', async (outcome, message) => {
  control.outcome = { outcome };
  const id = start();
  const session = await stateIs(id, 'failed');
  assert.equal(session.message, message);
  assert.equal(getReloginState(account.id).status, 'available');
  assert.equal(getReloginState(account.id).reason, outcome);
  assert.equal(listPendingActions(account.id).filter((action) => action.status === 'open').length, 0);
  assert.equal(loadAuthState(account.id).revision, 1);
  assert.equal(control.browser.close.mock.calls.length, 1);
  assertReleased();
});

it('fails identity mismatch with a safe message and preserves every stored auth byte', async () => {
  control.mallId = 900002;
  const before = get('SELECT * FROM auth_states WHERE account_id = ?', account.id);
  const id = start();
  const status = await stateIs(id, 'failed');
  assert.equal(status.message, '登录店铺与所选店铺不一致，未保存');
  assert.deepEqual(get('SELECT * FROM auth_states WHERE account_id = ?', account.id), before);
  assert.equal(control.browser.close.mock.calls.length, 1);
  assertReleased();
});

it('treats PASS_ID only as an acquisition signal and preserves auth after rejected verification', async () => {
  control.login = false;
  const id = start();
  assert.equal((await stateIs(id, 'failed')).message, '核验未通过，请重新登录');
  assert.equal(loadAuthState(account.id).revision, 1);
  assert.equal(control.browser.close.mock.calls.length, 1);
  assertReleased();
});

it.each(['launch', 'context', 'page'])('cleans up partial %s failures without exposing browser errors', async (failAt) => {
  control.failAt = failAt;
  const id = start();
  const status = await stateIs(id, 'failed');
  assert.equal(status.message, '登录未完成，请重试');
  assert.equal(JSON.stringify(status).includes('private'), false);
  if (failAt !== 'launch') assert.equal(control.browser.close.mock.calls.length, 1);
  assert.equal(loadAuthState(account.id).revision, 1);
  assertReleased();
});

it('cancels takeover with no counter or commit and releases the lease', async () => {
  control.outcome = { outcome: 'challenge', challenge: 'unknown' };
  const id = start();
  await stateIs(id, 'takeover');
  await cancelConsoleSession(id);
  assert.equal(getConsoleSession(id).state, 'cancelled');
  assert.equal(getReloginState(account.id).consecutive_takeover_timeouts, 0);
  assert.equal(loadAuthState(account.id).revision, 1);
  assertReleased();
});

it('captures and refreshes QR on the same device context, then verifies and commits', async () => {
  const id = start('qr');
  const status = await stateIs(id, 'qr');
  assert.ok(status.remaining_seconds <= 180);
  assert.match(status.qr_image, /^data:image\/png;base64,/);
  await refreshConsoleQr(id);
  assert.equal(captureQrElement.mock.calls.length, 2);
  assert.equal(captureQrElement.mock.calls[0][0], captureQrElement.mock.calls[1][0]);
  assert.equal(createSnapshotContext.mock.calls.length, 1);
  assert.equal(attemptPasswordLogin.mock.calls.length, 0);
  control.contexts[0].state.cookies.push(passCookie());
  await stateIs(id, 'succeeded');
  assert.equal(loadAuthState(account.id).revision, 2);
  assertReleased();
});

it('expires QR at three minutes without incrementing takeover timeouts', async () => {
  vi.useFakeTimers();
  const id = start('qr');
  await stateIs(id, 'qr');
  await vi.advanceTimersByTimeAsync(180_001);
  assert.equal(getConsoleSession(id).state, 'timed_out');
  assert.equal(getConsoleSession(id).message, null);
  assert.equal(getReloginState(account.id).consecutive_takeover_timeouts, 0);
  assert.equal(loadAuthState(account.id).revision, 1);
  assertReleased();
});

it('times out takeover at ten minutes, blocks the second timeout, and drops terminal sessions after five minutes', async () => {
  vi.useFakeTimers();
  control.outcome = { outcome: 'challenge', challenge: 'unknown' };
  const first = start();
  await stateIs(first, 'takeover');
  await vi.advanceTimersByTimeAsync(600_001);
  assert.equal(getConsoleSession(first).state, 'timed_out');
  assert.equal(getConsoleSession(first).message, null);
  assert.equal(getReloginState(account.id).consecutive_takeover_timeouts, 1);
  assertReleased();
  const second = start();
  await stateIs(second, 'takeover');
  await vi.advanceTimersByTimeAsync(600_001);
  assert.throws(() => getConsoleSession(first), { code: 'E_CONSOLE_SESSION_NOT_FOUND' });
  assert.equal(getConsoleSession(second).state, 'timed_out');
  assert.equal(getConsoleSession(second).message, null);
  assert.equal(getReloginState(account.id).status, 'blocked');
  assert.throws(() => start(), { code: 'E_AUTH_RELOGIN_BLOCKED', httpStatus: 409,
    message: '自动登录已暂停，请修改密码或扫码登录' });
  await vi.advanceTimersByTimeAsync(300_001);
  assert.throws(() => getConsoleSession(second), { code: 'E_CONSOLE_SESSION_NOT_FOUND' });
});

it('cancels a filling session on daemon abort, even when launch work settles later', async () => {
  let release;
  control.held = new Promise((resolve) => { release = resolve; });
  const parent = new AbortController();
  const id = start('password', { signal: parent.signal });
  await vi.waitFor(() => assert.equal(attemptPasswordLogin.mock.calls.length, 1));
  parent.abort();
  release();
  await stateIs(id, 'cancelled');
  assert.equal(loadAuthState(account.id).revision, 1);
  assert.ok(control.browser.close.mock.calls.length >= 1);
  assertReleased();
});

it('re-checks a block after acquiring the lease and never launches the browser', async () => {
  const id = start();
  putReloginState(account.id, { status: 'blocked', reason: 'wrong_password' });
  assert.equal((await stateIs(id, 'failed')).message, '自动登录已暂停，请修改密码或扫码登录');
  assert.equal(launchBrowser.mock.calls.length, 0);
  assertReleased();
});

it.each([
  ['wrong_password', true], ['wrong_password', false], ['account_locked', true],
  ['account_locked', false], ['takeover_timeout', true], ['takeover_timeout', false],
])('allows QR while blocked for %s with has_password=%s and preserves the pause', async (reason, hasPassword) => {
  if (!hasPassword) clearAccountPassword(account.id);
  const lastAttemptAt = '2026-01-01T00:00:00.000Z';
  putReloginState(account.id, { status: 'blocked', reason, consecutiveTakeoverTimeouts: 2, lastAttemptAt });
  insertPendingAction(account.id, { kind: 'relogin_blocked', reason });
  const actions = listPendingActions(account.id);
  assert.throws(() => start(), { code: 'E_AUTH_RELOGIN_BLOCKED', httpStatus: 409,
    message: '自动登录已暂停，请修改密码或扫码登录' });
  const id = start('qr');
  assert.equal((await stateIs(id, 'qr')).message, null);
  control.contexts[0].state.cookies.push(passCookie());
  assert.equal((await stateIs(id, 'succeeded')).message, null);
  const saved = loadAuthState(account.id);
  assert.equal(saved.revision, 2);
  assert.equal(saved.metadata.check_verdict, 'verified');
  const state = getReloginState(account.id);
  assert.equal(state.status, 'blocked');
  assert.equal(state.reason, reason);
  assert.equal(state.last_attempt_at, lastAttemptAt);
  assert.equal(state.consecutive_takeover_timeouts, 0);
  assert.deepEqual(listPendingActions(account.id), actions);
  assert.equal(attemptPasswordLogin.mock.calls.length, 0);
  assert.throws(() => start(), { code: 'E_AUTH_RELOGIN_BLOCKED', httpStatus: 409,
    message: '自动登录已暂停，请修改密码或扫码登录' });
  assertReleased();
});

it('fixture success uses the shared marker commit with no browser, and fixture controls stay offline', async () => {
  vi.stubEnv('PDD_TEST_ADAPTER', 'fixture');
  vi.stubEnv('PDD_TEST_PASSWORD_LOGIN', 'success');
  const id = start();
  await stateIs(id, 'succeeded');
  assert.equal(launchBrowser.mock.calls.length, 0);
  assert.equal(attemptPasswordLogin.mock.calls.length, 0);
  assert.ok(loadAuthState(account.id).state.cookies.some((cookie) => cookie.name === 'PDD_FIXTURE_RELOGIN'));
  assert.equal(getReloginState(account.id).status, 'available');
  assertReleased();
});

it('fixture-complete is rejected in live mode without changing session state', async () => {
  control.outcome = { outcome: 'challenge', challenge: 'unknown' };
  const id = start();
  await stateIs(id, 'takeover');
  await assert.rejects(completeFixtureConsoleSession(id, { outcome: 'success' }), { httpStatus: 404 });
  assert.equal(getConsoleSession(id).state, 'takeover');
});

it('preserves saved state on CAS conflict after the browser login', async () => {
  control.outcome = { outcome: 'challenge', challenge: 'unknown' };
  const id = start();
  await stateIs(id, 'takeover');
  run('UPDATE auth_states SET revision = revision + 1 WHERE account_id = ?', account.id);
  control.contexts[0].state.cookies.push(passCookie());
  await stateIs(id, 'failed');
  assert.equal(loadAuthState(account.id).revision, 2);
  assert.deepEqual(loadAuthState(account.id).state, original);
  assertReleased();
});

function startAdd(body = { login_name: 'private-login', password: 'private-password' }) {
  control.adding = true;
  return startConsoleAddSession(body, { ownerTag: 'test-daemon' }).session_id;
}

function credentialOf(accountId) {
  return get('SELECT updated_at FROM credentials WHERE account_id = ?', accountId)?.updated_at ?? null;
}

it('adds a new shop from a blank browser state, saves its password and clears the request body', async () => {
  control.mallId = 900099;
  const body = { login_name: 'private-login', password: 'private-password' };
  const id = startAdd(body);
  assert.deepEqual(body, {});
  const status = await stateIs(id, 'succeeded');
  assert.equal(status.message, '店铺已添加，密码已保存');
  assert.deepEqual(createSnapshotContext.mock.calls[0][1], { cookies: [], origins: [] });
  assert.deepEqual(attemptPasswordLogin.mock.calls[0][1], { loginName: 'private-login', password: 'private-password' });
  const added = listAccounts().find((item) => item.identity === '900099');
  assert.equal(added.display_name, 'Verified Shop');
  assert.ok(credentialOf(added.id));
  assert.equal(getReloginState(added.id).status, 'available');
  assert.equal(loadAuthState(added.id).metadata.check_verdict, 'verified');
  assert.equal(JSON.stringify(getConsoleSession(id)).includes('private'), false);
  assert.equal(control.browser.close.mock.calls.length, 1);
  assertReleased();
});

it('updates an already registered shop instead of adding a duplicate', async () => {
  const before = credentialOf(account.id);
  const id = startAdd();
  const status = await stateIs(id, 'succeeded');
  assert.equal(status.message, '店铺已存在，登录信息和密码已更新');
  assert.equal(listAccounts().length, 1);
  assert.equal(loadAuthState(account.id).revision, 2);
  assert.notEqual(credentialOf(account.id), before);
  assertReleased();
});

it('waits for the SMS code before adding the shop', async () => {
  control.mallId = 900099;
  control.outcome = { outcome: 'challenge', challenge: 'sms' };
  const id = startAdd();
  await stateIs(id, 'sms');
  assert.equal(listAccounts().length, 1);
  assert.deepEqual(await consoleSessionSms(id, { code: '123456' }), { ok: true, result: 'submitted' });
  control.contexts[0].state.cookies.push(passCookie());
  await stateIs(id, 'succeeded');
  assert.ok(listAccounts().some((item) => item.identity === '900099'));
  assertReleased();
});

it.each([['wrong_password', '登录名或密码错误，店铺未添加'], ['account_locked', '账号已锁定，请稍后重试'],
  ['form_changed', '自动填写失败，店铺未添加'], ['network_error', '网络异常，店铺未添加，请重试']])(
  'ends an add session on %s without registering anything', async (outcome, message) => {
    control.mallId = 900099;
    control.outcome = { outcome };
    const id = startAdd();
    const status = await stateIs(id, 'failed');
    assert.equal(status.message, message);
    assert.equal(listAccounts().length, 1);
    assert.equal(getReloginState(account.id)?.reason, 'password_reset');
    assert.equal(control.browser.close.mock.calls.length, 1);
    assertReleased();
  });

it('rejects incomplete credentials before starting and still clears the request body', () => {
  for (const body of [{}, { login_name: 'private-login' }, { login_name: ' ', password: 'private-password' },
    { login_name: 'private-login', password: 'x'.repeat(129) }]) {
    assert.throws(() => startAdd(body), (error) => error.code === 'E_USAGE' && !JSON.stringify(error).includes('private'));
    assert.deepEqual(body, {});
  }
  assert.equal(launchBrowser.mock.calls.length, 0);
});
