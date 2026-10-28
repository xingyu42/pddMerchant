import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { insertAccount, getAccountById, putReloginState, getReloginState, listPendingActions } from '../../src/infra/account-store.js';
import { get, run, isInTransaction } from '../../src/infra/db.js';
import { saveAuthStateSnapshot, loadAuthState } from '../../src/adapter/auth-state.js';
import { setAccountPassword } from '../../src/services/password-relogin.js';
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
    assert.ok(get("SELECT owner_token FROM leases WHERE scope = 'account'"));
    assert.ok(task.deadlineAt - Date.now() <= 70_000);
    assert.ok(task.deadlineAt - Date.now() > 69_000);
    assert.deepEqual(credential, { loginName: 'private-login', password: 'private-password' });
    if (control.held) await control.held;
    if (control.outcome.outcome === 'success') page.context().state.cookies.push(passCookie());
    return control.outcome;
  }),
}));

vi.mock('../../src/adapter/qr-login.js', () => ({
  captureQrElement: vi.fn(async () => {
    assert.equal(isInTransaction(), false);
    return Buffer.from('fixture-png');
  }),
}));

import { launchBrowser, createSnapshotContext } from '../../src/adapter/browser.js';
import { attemptPasswordLogin } from '../../src/adapter/password-login.js';
import { captureQrElement } from '../../src/adapter/qr-login.js';
import { startConsoleSession, getConsoleSession, cancelConsoleSession, refreshConsoleQr,
  closeAllConsoleSessions, completeFixtureConsoleSession } from '../../src/services/console-login.js';

let account;
let original;

function passCookie() { return { name: 'PASS_ID', value: 'synthetic-pass', domain: '.pinduoduo.com', path: '/', secure: true }; }

beforeEach(() => {
  vi.stubEnv('PDD_TEST_ADAPTER', '');
  control.contexts = [];
  control.browser = { close: vi.fn(async () => {}) };
  control.outcome = { outcome: 'success' };
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
  assert.equal(getReloginState(account.id).reason, outcome);
  assert.equal(listPendingActions(account.id).filter((action) => action.status === 'open').length, 1);
  assert.equal(loadAuthState(account.id).revision, 1);
  assert.equal(control.browser.close.mock.calls.length, 1);
  assertReleased();
});

it.each(['challenge', 'form_changed', 'network_error'])('offers takeover for %s and waits for PASS_ID before verification', async (outcome) => {
  control.outcome = { outcome, challenge: 'sms' };
  const id = start();
  const session = await stateIs(id, 'takeover');
  assert.ok(session.remaining_seconds > 590);
  assert.equal(loadAuthState(account.id).revision, 1);
  assert.equal(isInTransaction(), false);
  assert.ok(get("SELECT owner_token FROM leases WHERE scope = 'account'"));
  control.contexts[0].state.cookies.push(passCookie());
  await stateIs(id, 'succeeded');
  assert.equal(loadAuthState(account.id).revision, 2);
  assert.equal(listPendingActions(account.id).filter((action) => action.status === 'open').length, 0);
  assertReleased();
});

it('fails identity mismatch with an explicit safe code and preserves every stored auth byte', async () => {
  control.mallId = 900002;
  const before = get('SELECT * FROM auth_states WHERE account_id = ?', account.id);
  const id = start();
  const status = await stateIs(id, 'failed');
  assert.match(status.message, /E_ACCOUNT_IDENTITY_MISMATCH/);
  assert.deepEqual(get('SELECT * FROM auth_states WHERE account_id = ?', account.id), before);
  assert.equal(control.browser.close.mock.calls.length, 1);
  assertReleased();
});

it('treats PASS_ID only as an acquisition signal and preserves auth after rejected verification', async () => {
  control.login = false;
  const id = start();
  await stateIs(id, 'failed');
  assert.equal(loadAuthState(account.id).revision, 1);
  assert.equal(control.browser.close.mock.calls.length, 1);
  assertReleased();
});

it.each(['launch', 'context', 'page'])('cleans up partial %s failures without exposing browser errors', async (failAt) => {
  control.failAt = failAt;
  const id = start();
  const status = await stateIs(id, 'failed');
  assert.equal(JSON.stringify(status).includes('private'), false);
  if (failAt !== 'launch') assert.equal(control.browser.close.mock.calls.length, 1);
  assert.equal(loadAuthState(account.id).revision, 1);
  assertReleased();
});

it('cancels takeover with no counter or commit and releases the lease', async () => {
  control.outcome = { outcome: 'challenge', challenge: 'sms' };
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
  assert.equal(getReloginState(account.id).consecutive_takeover_timeouts, 0);
  assert.equal(loadAuthState(account.id).revision, 1);
  assertReleased();
});

it('times out takeover at ten minutes, blocks the second timeout, and drops terminal sessions after five minutes', async () => {
  vi.useFakeTimers();
  control.outcome = { outcome: 'challenge', challenge: 'sms' };
  const first = start();
  await stateIs(first, 'takeover');
  await vi.advanceTimersByTimeAsync(600_001);
  assert.equal(getConsoleSession(first).state, 'timed_out');
  assert.equal(getReloginState(account.id).consecutive_takeover_timeouts, 1);
  assertReleased();
  const second = start();
  await stateIs(second, 'takeover');
  await vi.advanceTimersByTimeAsync(600_001);
  assert.throws(() => getConsoleSession(first), { code: 'E_CONSOLE_SESSION_NOT_FOUND' });
  assert.equal(getConsoleSession(second).state, 'timed_out');
  assert.equal(getReloginState(account.id).status, 'blocked');
  assert.throws(() => start(), { code: 'E_AUTH_RELOGIN_BLOCKED', httpStatus: 409 });
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
  await stateIs(id, 'failed');
  assert.equal(launchBrowser.mock.calls.length, 0);
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
  control.outcome = { outcome: 'challenge', challenge: 'sms' };
  const id = start();
  await stateIs(id, 'takeover');
  await assert.rejects(completeFixtureConsoleSession(id, { outcome: 'success' }), { httpStatus: 404 });
  assert.equal(getConsoleSession(id).state, 'takeover');
});

it('preserves saved state on CAS conflict after the browser login', async () => {
  control.outcome = { outcome: 'challenge', challenge: 'sms' };
  const id = start();
  await stateIs(id, 'takeover');
  run('UPDATE auth_states SET revision = revision + 1 WHERE account_id = ?', account.id);
  control.contexts[0].state.cookies.push(passCookie());
  await stateIs(id, 'failed');
  assert.equal(loadAuthState(account.id).revision, 2);
  assert.deepEqual(loadAuthState(account.id).state, original);
  assertReleased();
});
