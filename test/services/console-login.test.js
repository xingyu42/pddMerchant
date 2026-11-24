import assert from 'node:assert/strict';
import { afterEach, beforeEach, it, vi } from 'vitest';
import {
  insertAccount,
  getAccountById,
  putReloginState,
  getReloginState,
  listPendingActions,
  listAccounts,
  insertPendingAction,
} from '../../src/infra/account-store.js';
import { get, run, isInTransaction } from '../../src/infra/db.js';
import { createCandidateSeal } from '../../src/infra/candidate-seal.js';
import { PddCliError, ExitCodes } from '../../src/infra/errors.js';
import { saveAuthStateSnapshot, loadAuthState } from '../../src/adapter/auth-state.js';
import { setAccountPassword, clearAccountPassword } from '../../src/services/relogin-policy.js';
import { createConsoleApp } from '../../src/services/console-login.js';
import { composeDaemonRuntime } from '../../src/runtime/daemon-runtime.js';
import { createInMemoryAuthPort, createInMemoryConsoleLoginDriver } from '../helpers/in-memory-ports.js';
import { createCliSandbox } from '../helpers/isolated-cli.js';

function createControllableClock(initialMs = Date.parse('2026-11-24T10:00:00.000Z')) {
  let nowMs = initialMs;
  const waiters = new Set();

  function sleep(ms, signal) {
    if (signal?.aborted) {
      return Promise.reject(new PddCliError({ code: 'E_TIMEOUT', message: '命令超时', exitCode: ExitCodes.NETWORK }));
    }
    const target = nowMs + ms;
    return new Promise((resolve, reject) => {
      const waiter = {
        target,
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          waiters.delete(waiter);
          resolve();
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort);
          waiters.delete(waiter);
          reject(error);
        },
      };
      const onAbort = () => {
        waiter.reject(new PddCliError({ code: 'E_TIMEOUT', message: '命令超时', exitCode: ExitCodes.NETWORK }));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      waiters.add(waiter);
      if (ms <= 0) waiter.resolve();
    });
  }

  async function advance(ms) {
    const destination = nowMs + ms;
    while (true) {
      const next = [...waiters].filter((waiter) => waiter.target <= destination).sort((a, b) => a.target - b.target)[0];
      if (!next) break;
      nowMs = Math.max(nowMs, next.target);
      next.resolve();
      await new Promise((resolve) => setImmediate(resolve));
    }
    nowMs = destination;
    await new Promise((resolve) => setImmediate(resolve));
  }

  return { now: () => nowMs, sleep, advance };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function passCookie() {
  return { name: 'PASS_ID', value: 'synthetic-pass', domain: '.pinduoduo.com', path: '/', secure: true };
}

function assertReleased() {
  assert.equal(get("SELECT count(*) AS total FROM leases WHERE scope = 'account'").total, 0);
}

function credentialOf(accountId) {
  return get('SELECT updated_at FROM credentials WHERE account_id = ?', accountId)?.updated_at ?? null;
}

const appsToClose = [];
let account;
let original;

beforeEach(() => {
  account = insertAccount({ identity: '900001', displayName: 'Shop' });
  original = {
    cookies: [passCookie(), { name: 'device', value: 'trust', domain: '.pinduoduo.com', path: '/' }],
    origins: [{ origin: 'https://mms.pinduoduo.com', localStorage: [{ name: 'device', value: 'trusted' }] }],
  };
  saveAuthStateSnapshot(original, account.id);
  setAccountPassword(account.id, { loginName: 'private-login', password: 'private-password' });
});

afterEach(async () => {
  for (const app of appsToClose.splice(0)) {
    await app.sessions.closeAll();
  }
});

function buildHarness({
  clock = createControllableClock(),
  seal = createCandidateSeal(),
  merchantVerdict = 'verified',
  merchantIdentity = { mallId: '900001', displayName: 'Verified Shop' },
  requirePassId = true,
  passwordOutcome = { outcome: 'success' },
  smsOutcome = { outcome: 'submitted' },
  contextState = { cookies: [passCookie()], origins: [] },
  commit,
  onOpenSession,
  onCaptureQr,
  onSubmitSms,
  onTakeoverClose,
  onPageClose,
  onClose,
  verifyHook,
} = {}) {
  const baseAuth = createInMemoryAuthPort({
    seal,
    authoritative: true,
    merchantVerdict,
    merchantIdentity,
    requirePassId,
    now: clock.now,
  });
  const authPort = verifyHook
    ? {
        ...baseAuth,
        verifyAndSeal: (target, opts) => verifyHook(target, opts, baseAuth),
      }
    : baseAuth;
  const driver = createInMemoryConsoleLoginDriver({
    seal,
    authPort,
    clock,
    passwordOutcome,
    smsOutcome,
    contextState,
    onOpenSession,
    onCaptureQr,
    onSubmitSms,
    onTakeoverClose,
    onPageClose,
    onClose,
  });
  const app = createConsoleApp({ driver, seal, clock, commit });
  appsToClose.push(app);
  return { app, driver, authPort, seal, clock };
}

it('uses device-continuous state, verifies after closing the page, and saves manual login through the shared path', async () => {
  putReloginState(account.id, {
    status: 'awaiting_human',
    reason: 'sms',
    consecutiveTakeoverTimeouts: 1,
    lastAttemptAt: new Date().toISOString(),
  });
  const events = [];
  const { app, driver, seal } = buildHarness({
    passwordOutcome: async (credential, task) => {
      assert.equal(isInTransaction(), false);
      assert.equal(Boolean(get("SELECT owner_token FROM leases WHERE scope = 'account'")), true);
      assert.ok(task.deadlineAt <= Date.parse('2026-11-24T10:00:00.000Z') + 70_000);
      assert.deepEqual(credential, { loginName: 'private-login', password: 'private-password' });
      return { outcome: 'success' };
    },
    onPageClose: () => events.push('page_closed'),
    verifyHook: async (target, opts, baseAuth) => {
      events.push('verify_called');
      assert.equal(opts.seal, seal);
      return baseAuth.verifyAndSeal(target, opts);
    },
  });

  const { session_id: id } = app.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' });
  assert.equal(Buffer.from(id, 'base64url').length, 16);
  await app.sessions.awaitDone(id);

  assert.equal(app.sessions.get(id).state, 'succeeded');
  const record = driver.lastSession();
  assert.deepEqual(record.deviceState.cookies, original.cookies.filter((cookie) => cookie.name !== 'PASS_ID'));
  assert.deepEqual(record.deviceState.origins, original.origins);
  assert.deepEqual(events, ['page_closed', 'verify_called']);
  assert.equal(record.closed, true);

  const saved = loadAuthState(account.id);
  assert.equal(saved.revision, 2);
  assert.equal(saved.metadata.check_verdict, 'verified');
  assert.equal(getReloginState(account.id).consecutive_takeover_timeouts, 0);
  assert.equal(getReloginState(account.id).status, 'available');
  assert.equal(getAccountById(account.id).display_name, 'Verified Shop');
  assert.ok(getAccountById(account.id).last_login_at);
  assertReleased();
});

it.each(['wrong_password', 'account_locked'])('records %s and closes the driver without committing', async (outcome) => {
  const { app, driver } = buildHarness({ passwordOutcome: { outcome } });
  const { session_id: id } = app.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' });
  await app.sessions.awaitDone(id);

  assert.equal(app.sessions.get(id).state, 'failed');
  assert.equal(app.sessions.get(id).message, '自动登录已暂停，请修改密码或扫码登录');
  assert.equal(getReloginState(account.id).status, 'blocked');
  assert.equal(getReloginState(account.id).reason, outcome);
  assert.equal(listPendingActions(account.id).filter((action) => action.status === 'open').length, 1);
  assert.equal(loadAuthState(account.id).revision, 1);
  assert.equal(driver.lastSession().closed, true);
  assertReleased();
});

it('rolls back the live login snapshot and manual reset when recording success fails', async () => {
  putReloginState(account.id, { status: 'awaiting_human', reason: 'sms', consecutiveTakeoverTimeouts: 1 });
  insertPendingAction(account.id, { kind: 'human_takeover', reason: 'sms' });
  const authBefore = get('SELECT * FROM auth_states WHERE account_id = ?', account.id);
  const accountBefore = getAccountById(account.id);
  const actionsBefore = listPendingActions(account.id);
  const { app } = buildHarness();

  run(`CREATE TEMP TRIGGER fail_relogin_success BEFORE UPDATE ON relogin_states
    WHEN NEW.reason = 'success' BEGIN SELECT RAISE(ABORT, 'synthetic outcome failure'); END`);
  try {
    const { session_id: id } = app.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' });
    await app.sessions.awaitDone(id);
    assert.equal(app.sessions.get(id).state, 'failed');
    assert.deepEqual(get('SELECT * FROM auth_states WHERE account_id = ?', account.id), authBefore);
    assert.deepEqual(getAccountById(account.id), accountBefore);
    assert.deepEqual(listPendingActions(account.id), actionsBefore);
    const state = getReloginState(account.id);
    assert.equal(state.status, 'awaiting_human');
    assert.equal(state.reason, 'sms');
    assert.equal(state.consecutive_takeover_timeouts, 1);
    assert.ok(state.last_attempt_at);
    assertReleased();
  } finally {
    run('DROP TRIGGER fail_relogin_success');
  }
});

it.each(['unknown', 'slider'])('offers captcha takeover for %s challenges and waits for completion before verification', async (challenge) => {
  const { app, driver } = buildHarness({ passwordOutcome: { outcome: 'challenge', challenge } });
  const { session_id: id } = app.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' });
  await driver.waitForWaiting(id);

  const session = app.sessions.get(id);
  assert.equal(session.state, 'takeover');
  assert.ok(session.remaining_seconds > 590);
  assert.equal(session.message, null);
  assert.equal(loadAuthState(account.id).revision, 1);
  assert.equal(isInTransaction(), false);
  assert.ok(get("SELECT owner_token FROM leases WHERE scope = 'account'"));

  driver.completeSession(id, 'success');
  await app.sessions.awaitDone(id);
  assert.equal(app.sessions.get(id).state, 'succeeded');
  assert.equal(loadAuthState(account.id).revision, 2);
  assert.equal(listPendingActions(account.id).filter((action) => action.status === 'open').length, 0);
  assertReleased();
});

it('asks for SMS without takeover picture, enforces single-flight lock, and validates input', async () => {
  const smsGate = createDeferred();
  let smsResult = { outcome: 'wrong_code' };
  let blockFirstSms = false;
  const { app, driver, clock } = buildHarness({
    passwordOutcome: { outcome: 'challenge', challenge: 'sms' },
    onSubmitSms: async (_code, task) => {
      assert.ok(task.deadlineAt <= clock.now() + 15_000);
      if (blockFirstSms) await smsGate.promise;
      return smsResult;
    },
  });

  const { session_id: id } = app.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' });
  await driver.waitForWaiting(id);

  const session = app.sessions.get(id);
  assert.equal(session.state, 'sms');
  assert.ok(session.remaining_seconds > 590);
  assert.equal(session.message, '短信验证码已发送到绑定手机');
  assert.equal(getReloginState(account.id).status, 'awaiting_human');

  await assert.rejects(app.sessions.pointer(id, { events: [] }), { code: 'E_CONSOLE_SESSION_STATE' });
  for (const code of ['12', '12345a', 123456]) {
    await assert.rejects(app.sessions.sms(id, { code }), { code: 'E_USAGE' });
  }
  assert.equal(driver.lastSession().smsCalls.length, 0);

  assert.deepEqual(await app.sessions.sms(id, { code: '000000' }), { ok: true, result: 'wrong_code' });

  blockFirstSms = true;
  smsResult = { outcome: 'submitted' };
  const inFlightSms = app.sessions.sms(id, { code: '123456' });
  await assert.rejects(app.sessions.sms(id, { code: '654321' }), { code: 'E_CONSOLE_SESSION_STATE', httpStatus: 409 });
  smsGate.resolve();
  assert.deepEqual(await inFlightSms, { ok: true, result: 'submitted' });

  driver.completeSession(id, 'success');
  await app.sessions.awaitDone(id);
  assert.equal(app.sessions.get(id).state, 'succeeded');
  assert.equal(loadAuthState(account.id).revision, 2);
  assert.equal(getReloginState(account.id).status, 'available');
  assertReleased();
});

it('shares deterministic pointer focus, interruption, cancellation, and SSE frame emission via InMemory driver', async () => {
  vi.useFakeTimers();
  const { app, driver } = buildHarness({ passwordOutcome: { outcome: 'challenge', challenge: 'slider' } });
  const { session_id: id } = app.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' });
  await driver.waitForWaiting(id);

  const received = [];
  const frames = app.sessions.frames(id);
  const unsubscribe = frames.subscribe((frame) => received.push(frame));
  driver.emitFrame(id, { jpeg: 'synthetic-frame', width: 100, height: 80 });
  await vi.advanceTimersByTimeAsync(200);
  assert.deepEqual(received, [{ jpeg: 'synthetic-frame', width: 100, height: 80 }]);
  unsubscribe();
  vi.useRealTimers();

  const events = [{ t: 0, type: 'down', x: 0, y: 0 }];
  await assert.rejects(app.sessions.pointer(id, { events }), { code: 'E_USAGE' });
  assert.deepEqual(
    await app.sessions.pointer(id, { gesture_id: 'drag', seq: 0, events }),
    { ok: true, editable: null, numeric: null },
  );
  const stopped = { ok: true, editable: null, numeric: null, result: 'interrupted' };
  assert.deepEqual(await app.sessions.pointer(id, { gesture_id: 'drag', seq: 0, events }), stopped);
  assert.deepEqual(await app.sessions.pointer(id, { gesture_id: 'drag', seq: 1, events: [], cancel: true }), stopped);
  assert.deepEqual(
    await app.sessions.pointer(id, { gesture_id: 'new', seq: 0, events: [...events, { ...events[0], type: 'up' }] }),
    { ok: true, editable: false, numeric: false },
  );
  await app.sessions.text(id, { text: '123456' });
  await app.sessions.text(id, { key: 'Enter' });
  assert.deepEqual(driver.lastSession().textCalls, ['123456']);
  assert.deepEqual(driver.lastSession().keyCalls, ['Enter']);
});

it.each(['existing', 'add'])('clears the SMS message immediately upon entering verifying for an %s shop', async (mode) => {
  const pageCloseStarted = createDeferred();
  const pageCloseRelease = createDeferred();
  const { app, driver } = buildHarness({
    passwordOutcome: { outcome: 'challenge', challenge: 'sms' },
    merchantIdentity: { mallId: mode === 'add' ? '900099' : '900001', displayName: 'Verified Shop' },
    onPageClose: async () => {
      pageCloseStarted.resolve();
      await pageCloseRelease.promise;
    },
  });

  const { session_id: id } = mode === 'add'
    ? app.sessions.startAdd({ login_name: 'private-login', password: 'private-password' }, { ownerTag: 'test-daemon' })
    : app.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' });

  await driver.waitForWaiting(id);
  assert.equal(app.sessions.get(id).message, '短信验证码已发送到绑定手机');

  try {
    driver.completeSession(id, 'success');
    await pageCloseStarted.promise;
    const verifying = app.sessions.get(id);
    assert.equal(verifying.state, 'verifying');
    assert.equal(verifying.message, null);
    assert.equal(verifying.qr_image, null);
    assert.equal(loadAuthState(account.id).revision, 1);
    assert.equal(listAccounts().length, 1);
  } finally {
    pageCloseRelease.resolve();
  }

  await app.sessions.awaitDone(id);
  const succeeded = app.sessions.get(id);
  assert.equal(succeeded.state, 'succeeded');
  assert.equal(succeeded.message, mode === 'add' ? '店铺已添加，密码已保存' : null);
  assertReleased();
});

it('clears qr_image on entering verifying and drains in-flight QR refresh before verify', async () => {
  const events = [];
  let holdSecondCapture = false;
  const secondCaptureStarted = createDeferred();
  const secondCaptureRelease = createDeferred();

  const { app, driver } = buildHarness({
    onCaptureQr: async () => {
      events.push('qr_capture_start');
      if (holdSecondCapture) {
        secondCaptureStarted.resolve();
        await secondCaptureRelease.promise;
      }
      events.push('qr_capture_end');
    },
    onPageClose: () => events.push('page_closed'),
    verifyHook: async (target, opts, baseAuth) => {
      events.push('verify_called');
      return baseAuth.verifyAndSeal(target, opts);
    },
  });

  const { session_id: id } = app.sessions.start(account.slug, { mode: 'qr', ownerTag: 'test-daemon' });
  await driver.waitForWaiting(id);
  assert.match(app.sessions.get(id).qr_image, /^data:image\/png;base64,/);

  holdSecondCapture = true;
  const refreshPending = app.sessions.refreshQr(id);
  await secondCaptureStarted.promise;

  // Single-flight lock rejects concurrent QR refresh.
  await assert.rejects(app.sessions.refreshQr(id), { code: 'E_CONSOLE_SESSION_STATE', httpStatus: 409 });

  driver.completeSession(id, 'success');
  await new Promise((resolve) => setImmediate(resolve));
  const verifying = app.sessions.get(id);
  assert.equal(verifying.state, 'verifying');
  assert.equal(verifying.message, null);
  assert.equal(verifying.qr_image, null);
  assert.equal(events.includes('page_closed'), false);

  secondCaptureRelease.resolve();
  await refreshPending;
  await app.sessions.awaitDone(id);

  assert.equal(app.sessions.get(id).state, 'succeeded');
  assert.deepEqual(events, [
    'qr_capture_start',
    'qr_capture_end',
    'qr_capture_start',
    'qr_capture_end',
    'page_closed',
    'verify_called',
  ]);
  assertReleased();
});

it.each([
  ['form_changed', '自动填写失败，请扫码登录'],
  ['network_error', '登录未完成，请重试或扫码登录'],
])('ends %s by its result code without takeover', async (outcome, message) => {
  const { app, driver } = buildHarness({ passwordOutcome: { outcome } });
  const { session_id: id } = app.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' });
  await app.sessions.awaitDone(id);

  const session = app.sessions.get(id);
  assert.equal(session.state, 'failed');
  assert.equal(session.message, message);
  assert.equal(getReloginState(account.id).status, 'available');
  assert.equal(getReloginState(account.id).reason, outcome);
  assert.equal(listPendingActions(account.id).filter((action) => action.status === 'open').length, 0);
  assert.equal(loadAuthState(account.id).revision, 1);
  assert.equal(driver.lastSession().closed, true);
  assertReleased();
});

it('fails identity mismatch with a safe message and preserves every stored auth byte', async () => {
  const { app, driver } = buildHarness({ merchantIdentity: { mallId: '900002', displayName: 'Other Shop' } });
  const before = get('SELECT * FROM auth_states WHERE account_id = ?', account.id);
  const { session_id: id } = app.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' });
  await app.sessions.awaitDone(id);

  const status = app.sessions.get(id);
  assert.equal(status.state, 'failed');
  assert.equal(status.message, '登录店铺与所选店铺不一致，未保存');
  assert.deepEqual(get('SELECT * FROM auth_states WHERE account_id = ?', account.id), before);
  assert.equal(driver.lastSession().closed, true);
  assertReleased();
});

it('treats PASS_ID only as an acquisition signal and preserves auth after rejected verification or foreign seal', async () => {
  const { app, driver } = buildHarness({ merchantVerdict: 'rejected' });
  const { session_id: id } = app.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' });
  await app.sessions.awaitDone(id);
  assert.equal(app.sessions.get(id).state, 'failed');
  assert.equal(app.sessions.get(id).message, '核验未通过，请重新登录');
  assert.equal(loadAuthState(account.id).revision, 1);
  assert.equal(driver.lastSession().closed, true);

  const sealA = createCandidateSeal();
  const sealB = createCandidateSeal();
  const authA = createInMemoryAuthPort({ seal: sealA, authoritative: true });
  const driverA = createInMemoryConsoleLoginDriver({ seal: sealA, authPort: authA });
  const appB = createConsoleApp({ driver: driverA, seal: sealB });
  appsToClose.push(appB);
  const { session_id: foreignId } = appB.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' });
  await appB.sessions.awaitDone(foreignId);
  assert.equal(appB.sessions.get(foreignId).state, 'failed');
  assert.equal(loadAuthState(account.id).revision, 1);
  assertReleased();
});

it('cleans up partial driver open failures without exposing private error details', async () => {
  const { app } = buildHarness({
    onOpenSession: async () => {
      throw new Error('private driver failure');
    },
  });
  const { session_id: id } = app.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' });
  await app.sessions.awaitDone(id);

  const status = app.sessions.get(id);
  assert.equal(status.state, 'failed');
  assert.equal(status.message, '登录未完成，请重试');
  assert.equal(JSON.stringify(status).includes('private'), false);
  assert.equal(loadAuthState(account.id).revision, 1);
  assertReleased();
});

it('cancels takeover with no counter or commit and releases the lease', async () => {
  const { app, driver } = buildHarness({ passwordOutcome: { outcome: 'challenge', challenge: 'unknown' } });
  const { session_id: id } = app.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' });
  await driver.waitForWaiting(id);

  await app.sessions.cancel(id);
  assert.equal(app.sessions.get(id).state, 'cancelled');
  assert.equal(getReloginState(account.id).consecutive_takeover_timeouts, 0);
  assert.equal(loadAuthState(account.id).revision, 1);
  assertReleased();
});

it('captures and refreshes QR on the same session handle, then verifies and commits', async () => {
  const { app, driver } = buildHarness();
  const { session_id: id } = app.sessions.start(account.slug, { mode: 'qr', ownerTag: 'test-daemon' });
  await driver.waitForWaiting(id);

  const status = app.sessions.get(id);
  assert.ok(status.remaining_seconds <= 180);
  assert.match(status.qr_image, /^data:image\/png;base64,/);

  await app.sessions.refreshQr(id);
  assert.equal(driver.sessions.size, 1);
  assert.equal(driver.lastSession().timeline.filter((step) => step === 'qr_captured').length, 2);
  assert.equal(driver.lastSession().timeline.includes('password_attempted'), false);

  driver.completeSession(id, 'success');
  await app.sessions.awaitDone(id);
  assert.equal(app.sessions.get(id).state, 'succeeded');
  assert.equal(loadAuthState(account.id).revision, 2);
  assertReleased();
});

it('expires QR at three minutes via controllable clock without incrementing takeover timeouts', async () => {
  const clock = createControllableClock();
  const { app, driver } = buildHarness({ clock });
  const { session_id: id } = app.sessions.start(account.slug, { mode: 'qr', ownerTag: 'test-daemon' });
  await driver.waitForWaiting(id);

  await clock.advance(180_001);
  await app.sessions.awaitDone(id);
  assert.equal(app.sessions.get(id).state, 'timed_out');
  assert.equal(app.sessions.get(id).message, null);
  assert.equal(getReloginState(account.id).consecutive_takeover_timeouts, 0);
  assert.equal(loadAuthState(account.id).revision, 1);
  assertReleased();
});

it('times out takeover/sms at ten minutes, blocks on second timeout, enforces 12-min ceiling, and drops after 5-min GC', async () => {
  const clock = createControllableClock();
  const { app, driver } = buildHarness({
    clock,
    passwordOutcome: { outcome: 'challenge', challenge: 'unknown' },
  });

  const first = app.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' }).session_id;
  await driver.waitForWaiting(first);
  await clock.advance(600_001);
  await app.sessions.awaitDone(first);
  assert.equal(app.sessions.get(first).state, 'timed_out');
  assert.equal(app.sessions.get(first).message, null);
  assert.equal(getReloginState(account.id).consecutive_takeover_timeouts, 1);
  assertReleased();

  const second = app.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' }).session_id;
  await driver.waitForWaiting(second);
  await clock.advance(600_001);
  await app.sessions.awaitDone(second);
  assert.throws(() => app.sessions.get(first), { code: 'E_CONSOLE_SESSION_NOT_FOUND' });
  assert.equal(app.sessions.get(second).state, 'timed_out');
  assert.equal(app.sessions.get(second).message, null);
  assert.equal(getReloginState(account.id).status, 'blocked');
  assert.throws(
    () => app.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' }),
    { code: 'E_AUTH_RELOGIN_BLOCKED', httpStatus: 409, message: '自动登录已暂停，请修改密码或扫码登录' },
  );

  await clock.advance(300_001);
  assert.throws(() => app.sessions.get(second), { code: 'E_CONSOLE_SESSION_NOT_FOUND' });

  // 12-minute session ceiling aborts an active filling session.
  const thirdAccount = insertAccount({ identity: '900002', displayName: 'Ceiling Shop' });
  saveAuthStateSnapshot(original, thirdAccount.id);
  setAccountPassword(thirdAccount.id, { loginName: 'private-login', password: 'private-password' });
  const fillingGate = createDeferred();
  const { app: appCeiling } = buildHarness({
    clock,
    passwordOutcome: async () => {
      await fillingGate.promise;
      return { outcome: 'success' };
    },
  });
  const ceilingId = appCeiling.sessions.start(thirdAccount.slug, { mode: 'password', ownerTag: 'test-daemon' }).session_id;
  await clock.advance(720_001);
  fillingGate.resolve();
  await appCeiling.sessions.awaitDone(ceilingId);
  assert.equal(appCeiling.sessions.get(ceilingId).state, 'timed_out');
  assertReleased();
});

it('cancels a filling session on daemon abort, even when password step settles later', async () => {
  const passwordStarted = createDeferred();
  const releasePassword = createDeferred();
  const { app, driver } = buildHarness({
    passwordOutcome: async () => {
      passwordStarted.resolve();
      await releasePassword.promise;
      return { outcome: 'success' };
    },
  });

  const parent = new AbortController();
  const { session_id: id } = app.sessions.start(account.slug, {
    mode: 'password',
    ownerTag: 'test-daemon',
    signal: parent.signal,
  });
  await passwordStarted.promise;
  parent.abort();
  releasePassword.resolve();
  await app.sessions.awaitDone(id);

  assert.equal(app.sessions.get(id).state, 'cancelled');
  assert.equal(loadAuthState(account.id).revision, 1);
  assert.equal(driver.lastSession().closed, true);
  assertReleased();
});

it('re-checks a block after acquiring the lease and never opens the driver', async () => {
  const { app, driver } = buildHarness();
  const { session_id: id } = app.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' });
  putReloginState(account.id, { status: 'blocked', reason: 'wrong_password' });
  await app.sessions.awaitDone(id);

  assert.equal(app.sessions.get(id).state, 'failed');
  assert.equal(app.sessions.get(id).message, '自动登录已暂停，请修改密码或扫码登录');
  assert.equal(driver.sessions.size, 0);
  assertReleased();
});

it.each([
  ['wrong_password', true],
  ['wrong_password', false],
  ['account_locked', true],
  ['account_locked', false],
  ['takeover_timeout', true],
  ['takeover_timeout', false],
])('allows QR while blocked for %s with has_password=%s and preserves the pause', async (reason, hasPassword) => {
  if (!hasPassword) clearAccountPassword(account.id);
  const lastAttemptAt = '2026-01-01T00:00:00.000Z';
  putReloginState(account.id, { status: 'blocked', reason, consecutiveTakeoverTimeouts: 2, lastAttemptAt });
  insertPendingAction(account.id, { kind: 'relogin_blocked', reason });
  const actions = listPendingActions(account.id);

  const { app, driver } = buildHarness();
  assert.throws(
    () => app.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' }),
    { code: 'E_AUTH_RELOGIN_BLOCKED', httpStatus: 409, message: '自动登录已暂停，请修改密码或扫码登录' },
  );

  const { session_id: id } = app.sessions.start(account.slug, { mode: 'qr', ownerTag: 'test-daemon' });
  await driver.waitForWaiting(id);
  assert.equal(app.sessions.get(id).message, null);
  driver.completeSession(id, 'success');
  await app.sessions.awaitDone(id);

  assert.equal(app.sessions.get(id).state, 'succeeded');
  assert.equal(app.sessions.get(id).message, null);
  const saved = loadAuthState(account.id);
  assert.equal(saved.revision, 2);
  assert.equal(saved.metadata.check_verdict, 'verified');
  const state = getReloginState(account.id);
  assert.equal(state.status, 'blocked');
  assert.equal(state.reason, reason);
  assert.equal(state.last_attempt_at, lastAttemptAt);
  assert.equal(state.consecutive_takeover_timeouts, 0);
  assert.deepEqual(listPendingActions(account.id), actions);
  assert.equal(driver.lastSession().timeline.includes('password_attempted'), false);
  assertReleased();
});

it('serializes same-key replacement cleanup and counts closing sessions in the 2-key global cap', async () => {
  const accountB = insertAccount({ identity: '900002', displayName: 'Shop B' });
  const accountC = insertAccount({ identity: '900003', displayName: 'Shop C' });
  for (const acc of [accountB, accountC]) {
    saveAuthStateSnapshot(original, acc.id);
    setAccountPassword(acc.id, { loginName: 'private-login', password: 'private-password' });
  }

  const closeStarted = createDeferred();
  const releaseFirstClose = createDeferred();
  const events = [];
  let holdFirstClose = true;

  const { app, driver } = buildHarness({
    passwordOutcome: { outcome: 'challenge', challenge: 'unknown' },
    onOpenSession: (record) => {
      events.push(`open:${record.sessionId}`);
    },
    onClose: async (record) => {
      events.push(`close_start:${record.sessionId}`);
      if (holdFirstClose) {
        holdFirstClose = false;
        closeStarted.resolve();
        await releaseFirstClose.promise;
      }
      events.push(`close_end:${record.sessionId}`);
    },
  });

  const first = app.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' }).session_id;
  await driver.waitForWaiting(first);
  const second = app.sessions.start(accountB.slug, { mode: 'password', ownerTag: 'test-daemon' }).session_id;
  await driver.waitForWaiting(second);

  // Third distinct key is rejected while 2 distinct keys are active.
  assert.throws(
    () => app.sessions.start(accountC.slug, { mode: 'password', ownerTag: 'test-daemon' }),
    { code: 'E_CONSOLE_BUSY', httpStatus: 429 },
  );

  // Cancel key B, but hold its cleanup so key B still occupies a slot until cleanup finishes.
  const cancelB = app.sessions.cancel(second);
  await closeStarted.promise;
  assert.throws(
    () => app.sessions.start(accountC.slug, { mode: 'password', ownerTag: 'test-daemon' }),
    { code: 'E_CONSOLE_BUSY', httpStatus: 429 },
  );
  releaseFirstClose.resolve();
  await cancelB;

  // Same-key replacement aborts old session for account A and waits for its cleanup before opening new driver.
  holdFirstClose = true;
  const replaceCloseStarted = createDeferred();
  const releaseReplaceClose = createDeferred();
  const { app: appReplace, driver: driverReplace } = buildHarness({
    passwordOutcome: { outcome: 'challenge', challenge: 'unknown' },
    onOpenSession: (record) => events.push(`replace_open:${record.sessionId}`),
    onClose: async (record) => {
      events.push(`replace_close_start:${record.sessionId}`);
      if (holdFirstClose) {
        holdFirstClose = false;
        replaceCloseStarted.resolve();
        await releaseReplaceClose.promise;
      }
      events.push(`replace_close_end:${record.sessionId}`);
    },
  });

  const oldId = appReplace.sessions.start(accountC.slug, { mode: 'password', ownerTag: 'test-daemon' }).session_id;
  await driverReplace.waitForWaiting(oldId);
  const newId = appReplace.sessions.start(accountC.slug, { mode: 'password', ownerTag: 'test-daemon' }).session_id;
  await replaceCloseStarted.promise;
  assert.equal(events.includes(`replace_open:${newId}`), false);
  releaseReplaceClose.resolve();
  await driverReplace.waitForWaiting(newId);
  assert.ok(events.indexOf(`replace_close_end:${oldId}`) < events.indexOf(`replace_open:${newId}`));
  assert.equal(appReplace.sessions.get(oldId).state, 'cancelled');
});

it('rejects account removal while an account session is active and allows it once finished', async () => {
  const { app, driver } = buildHarness({ passwordOutcome: { outcome: 'challenge', challenge: 'unknown' } });
  const { session_id: id } = app.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' });
  await driver.waitForWaiting(id);

  assert.throws(
    () => app.accounts.remove(account.slug, { confirm_name: account.display_name }),
    { code: 'E_CONSOLE_SESSION_STATE', httpStatus: 409 },
  );

  await app.sessions.cancel(id);
  assert.deepEqual(
    app.accounts.remove(account.slug, { confirm_name: account.display_name }),
    { ok: true, removed: true },
  );
});

it('rejects new sessions with 503 E_CONSOLE_STOPPING after closeAll and isolates sessions per instance', async () => {
  const { app: appA, driver: driverA } = buildHarness({ passwordOutcome: { outcome: 'challenge', challenge: 'unknown' } });
  const { app: appB, driver: driverB } = buildHarness({ passwordOutcome: { outcome: 'challenge', challenge: 'unknown' } });

  const idA = appA.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' }).session_id;
  await driverA.waitForWaiting(idA);
  assert.throws(() => appB.sessions.get(idA), { code: 'E_CONSOLE_SESSION_NOT_FOUND', httpStatus: 404 });

  await appA.sessions.closeAll();
  assert.throws(
    () => appA.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' }),
    { code: 'E_CONSOLE_STOPPING', httpStatus: 503 },
  );
  assert.throws(
    () => appA.sessions.startAdd({ login_name: 'u', password: 'p' }, { ownerTag: 'test-daemon' }),
    { code: 'E_CONSOLE_STOPPING', httpStatus: 503 },
  );

  // Instance B remains completely independent.
  const idB = appB.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' }).session_id;
  await driverB.waitForWaiting(idB);
  assert.equal(appB.sessions.get(idB).state, 'takeover');
});

it('preserves saved state on CAS conflict after the login acquisition', async () => {
  const { app, driver } = buildHarness({ passwordOutcome: { outcome: 'challenge', challenge: 'unknown' } });
  const { session_id: id } = app.sessions.start(account.slug, { mode: 'password', ownerTag: 'test-daemon' });
  await driver.waitForWaiting(id);

  run('UPDATE auth_states SET revision = revision + 1 WHERE account_id = ?', account.id);
  driver.completeSession(id, 'success');
  await app.sessions.awaitDone(id);

  assert.equal(app.sessions.get(id).state, 'failed');
  assert.equal(loadAuthState(account.id).revision, 2);
  assert.deepEqual(loadAuthState(account.id).state, original);
  assertReleased();
});

it('adds a new shop from a blank browser state, saves its password, and clears credentials everywhere', async () => {
  const { app, driver } = buildHarness({
    merchantIdentity: { mallId: '900099', displayName: 'Verified Shop' },
    passwordOutcome: async (credential) => {
      assert.equal(isInTransaction(), false);
      assert.equal(Boolean(get("SELECT owner_token FROM leases WHERE scope = 'account'")), false);
      assert.deepEqual(credential, { loginName: 'private-login', password: 'private-password' });
      return { outcome: 'success' };
    },
  });

  const body = { login_name: 'private-login', password: 'private-password' };
  const { session_id: id } = app.sessions.startAdd(body, { ownerTag: 'test-daemon' });
  assert.deepEqual(body, {});
  await app.sessions.awaitDone(id);

  const status = app.sessions.get(id);
  assert.equal(status.state, 'succeeded');
  assert.equal(status.message, '店铺已添加，密码已保存');
  assert.deepEqual(driver.lastSession().deviceState, { cookies: [], origins: [] });
  const added = listAccounts().find((item) => item.identity === '900099');
  assert.equal(added.display_name, 'Verified Shop');
  assert.ok(credentialOf(added.id));
  assert.equal(getReloginState(added.id).status, 'available');
  assert.equal(loadAuthState(added.id).metadata.check_verdict, 'verified');
  assert.equal(JSON.stringify(status).includes('private'), false);
  assert.equal(driver.lastSession().closed, true);
  assertReleased();
});

it('updates an already registered shop via add instead of adding a duplicate', async () => {
  const before = credentialOf(account.id);
  const { app } = buildHarness({ merchantIdentity: { mallId: '900001', displayName: 'Verified Shop' } });
  const { session_id: id } = app.sessions.startAdd(
    { login_name: 'private-login', password: 'private-password' },
    { ownerTag: 'test-daemon' },
  );
  await app.sessions.awaitDone(id);

  const status = app.sessions.get(id);
  assert.equal(status.state, 'succeeded');
  assert.equal(status.message, '店铺已存在，登录信息和密码已更新');
  assert.equal(listAccounts().length, 1);
  assert.equal(loadAuthState(account.id).revision, 2);
  assert.notEqual(credentialOf(account.id), before);
  assertReleased();
});

it('waits for SMS before adding a shop and leaves counters untouched if add takeover times out', async () => {
  const clock = createControllableClock();
  const { app: smsApp, driver: smsDriver } = buildHarness({
    clock,
    merchantIdentity: { mallId: '900099', displayName: 'Verified Shop' },
    passwordOutcome: { outcome: 'challenge', challenge: 'sms' },
  });
  const { session_id: smsId } = smsApp.sessions.startAdd(
    { login_name: 'private-login', password: 'private-password' },
    { ownerTag: 'test-daemon' },
  );
  await smsDriver.waitForWaiting(smsId);
  assert.equal(listAccounts().length, 1);
  assert.deepEqual(await smsApp.sessions.sms(smsId, { code: '123456' }), { ok: true, result: 'submitted' });
  smsDriver.completeSession(smsId, 'success');
  await smsApp.sessions.awaitDone(smsId);
  assert.ok(listAccounts().some((item) => item.identity === '900099'));

  const { app: timeoutApp, driver: timeoutDriver } = buildHarness({
    clock,
    merchantIdentity: { mallId: '900100', displayName: 'Timeout Shop' },
    passwordOutcome: { outcome: 'challenge', challenge: 'unknown' },
  });
  const { session_id: timeoutId } = timeoutApp.sessions.startAdd(
    { login_name: 'private-login', password: 'private-password' },
    { ownerTag: 'test-daemon' },
  );
  await timeoutDriver.waitForWaiting(timeoutId);
  await clock.advance(600_001);
  await timeoutApp.sessions.awaitDone(timeoutId);
  assert.equal(timeoutApp.sessions.get(timeoutId).state, 'timed_out');
  assert.equal(getReloginState(account.id)?.consecutive_takeover_timeouts ?? 0, 0);
  assert.equal(listAccounts().some((item) => item.identity === '900100'), false);
  assertReleased();
});

it.each([
  ['wrong_password', '登录名或密码错误，店铺未添加'],
  ['account_locked', '账号已锁定，请稍后重试'],
  ['form_changed', '自动填写失败，店铺未添加'],
  ['network_error', '网络异常，店铺未添加，请重试'],
])('ends an add session on %s without registering anything', async (outcome, message) => {
  const { app, driver } = buildHarness({
    merchantIdentity: { mallId: '900099', displayName: 'Unadded Shop' },
    passwordOutcome: { outcome },
  });
  const { session_id: id } = app.sessions.startAdd(
    { login_name: 'private-login', password: 'private-password' },
    { ownerTag: 'test-daemon' },
  );
  await app.sessions.awaitDone(id);

  const status = app.sessions.get(id);
  assert.equal(status.state, 'failed');
  assert.equal(status.message, message);
  assert.equal(listAccounts().length, 1);
  assert.equal(getReloginState(account.id)?.reason, 'password_reset');
  assert.equal(driver.lastSession().closed, true);
  assertReleased();
});

it('rejects incomplete credentials before starting and still clears the request body', () => {
  const { app, driver } = buildHarness();
  for (const body of [
    {},
    { login_name: 'private-login' },
    { login_name: ' ', password: 'private-password' },
    { login_name: 'private-login', password: 'x'.repeat(129) },
  ]) {
    assert.throws(
      () => app.sessions.startAdd(body, { ownerTag: 'test-daemon' }),
      (error) => error.code === 'E_USAGE' && !JSON.stringify(error).includes('private'),
    );
    assert.deepEqual(body, {});
  }
  assert.equal(driver.sessions.size, 0);
});

it('composes fixture consoleApp via composeDaemonRuntime using saveMerchantLogin and fixture-complete route', async () => {
  const sandbox = createCliSandbox({
    'shops.current.json': { id: '900099', name: 'Added Fixture Shop' },
  });
  const runtime = await composeDaemonRuntime({
    mode: 'fixture',
    foreground: false,
    env: { PDD_TEST_FIXTURE_DIR: sandbox.fixtureDir, PDD_TEST_PASSWORD_LOGIN: 'success' },
  });
  try {
    const { session_id: reloginId } = runtime.consoleApp.sessions.start(account.slug, {
      mode: 'password',
      ownerTag: 'test-daemon',
    });
    await runtime.consoleApp.sessions.awaitDone(reloginId);
    assert.equal(runtime.consoleApp.sessions.get(reloginId).state, 'succeeded');
    assert.ok(loadAuthState(account.id).state.cookies.some((cookie) => cookie.name === 'PDD_FIXTURE_RELOGIN'));

    const { session_id: addId } = runtime.consoleApp.sessions.startAdd(
      { login_name: 'private-login', password: 'private-password' },
      { ownerTag: 'test-daemon' },
    );
    await runtime.consoleApp.sessions.awaitDone(addId);
    assert.equal(runtime.consoleApp.sessions.get(addId).message, '店铺已添加，密码已保存');
    assert.ok(listAccounts().some((item) => item.identity === '900099'));
    assertReleased();
  } finally {
    await runtime.closeAll();
    sandbox.dispose();
  }
});
