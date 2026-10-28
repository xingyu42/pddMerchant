import assert from 'node:assert/strict';
import { it, vi } from 'vitest';
import * as browser from '../../src/adapter/browser.js';
import * as authStorage from '../../src/adapter/merchant-auth-storage.js';
import * as mocks from '../../src/adapter/mock-dispatcher.js';
import * as relogin from '../../src/services/password-relogin.js';
import { createPatrol, patrolDelayMs, patrolIntervalMs, runPatrolRound } from '../../src/services/patrol.js';
import { insertAccount, updateAccount, getReloginState } from '../../src/infra/account-store.js';
import { saveAuthStateSnapshot, loadAuthState } from '../../src/adapter/auth-state.js';
import { acquireLease, releaseLease, assertLeaseOwner } from '../../src/infra/leases.js';
import { getDaemonMeta } from '../../src/infra/daemon-state.js';
import { get, isInTransaction } from '../../src/infra/db.js';
import { abortableSleep } from '../../src/infra/abort.js';

const checkedAt = '2026-10-28T01:00:00.000Z';
const credential = { loginName: 'synthetic-patrol-login', password: 'synthetic-patrol-password' };

function account(identity = '900001', kind = 'merchant') {
  const row = insertAccount({ identity, displayName: `Shop ${identity}`, kind });
  saveAuthStateSnapshot({ cookies: [], origins: [] }, row.id);
  return row;
}

function context(overrides = {}) {
  return { signal: new AbortController().signal, ownerTag: 'patrol-test',
    log: { info: vi.fn(), warn: vi.fn() },
    runtimeConfig: { patrolEnabled: true, patrolIntervalMs: 1000, passwordReloginMinIntervalMs: 1_800_000 },
    ...overrides };
}

function live(verify) {
  vi.stubEnv('PDD_TEST_ADAPTER', '');
  const session = { browser: {}, context: {}, page: { goto: vi.fn() } };
  const launch = vi.spyOn(browser, 'withBrowser').mockImplementation(async (_options, callback) => callback(session));
  const close = vi.spyOn(browser, 'closeBrowser').mockResolvedValue();
  const check = vi.spyOn(authStorage, 'verifyStoredMerchant').mockImplementation(verify);
  return { session, launch, close, check };
}

it('keeps jitter within +/-20% with injectable random endpoints and midpoint', () => {
  assert.equal(patrolDelayMs(1_800_000, () => 0), 1_440_000);
  assert.equal(patrolDelayMs(1_800_000, () => 0.5), 1_800_000);
  assert.equal(patrolDelayMs(1_800_000, () => 1), 2_160_000);
  for (let index = 0; index <= 100; index++) {
    const delay = patrolDelayMs(300_000, () => index / 100);
    assert.ok(delay >= 240_000 && delay <= 360_000);
  }
});

it.each(['', '0', '-1', '1.5', 'invalid', '9007199254740992'])('ignores invalid fixture interval %j', (value) => {
  vi.stubEnv('PDD_TEST_PATROL_INTERVAL_MS', value);
  assert.equal(patrolIntervalMs({ patrolIntervalMs: 300_000 }), 300_000);
});

it('accepts a short fixture interval and ignores it in live mode', () => {
  vi.stubEnv('PDD_TEST_PATROL_INTERVAL_MS', '50');
  assert.equal(patrolIntervalMs({ patrolIntervalMs: 300_000 }), 50);
  vi.stubEnv('PDD_TEST_ADAPTER', '');
  assert.equal(patrolIntervalMs({ patrolIntervalMs: 300_000 }), 300_000);
});

it.each([undefined, false, 'true', 1])('has no rounds or timers unless enabled is exactly true (%j)', async (patrolEnabled) => {
  vi.useFakeTimers();
  const clock = { now: vi.fn(), sleep: vi.fn() };
  const patrol = createPatrol({ clock });
  await patrol.start(context({ runtimeConfig: { patrolEnabled, patrolIntervalMs: 1000 } }));
  await vi.advanceTimersByTimeAsync(100_000);
  await patrol.stop();
  assert.equal(clock.sleep.mock.calls.length, 0);
  assert.equal(getDaemonMeta('daemon_last_patrol_at'), null);
  assert.equal(vi.getTimerCount(), 0);
});

it('waits one interval before the first round and records the injected clock only after completion', async () => {
  vi.useFakeTimers();
  const clock = { now: () => Date.parse(checkedAt), sleep: abortableSleep };
  const patrol = createPatrol({ random: () => 0.5, clock });
  await patrol.start(context());
  assert.equal(getDaemonMeta('daemon_last_patrol_at'), null);
  await vi.advanceTimersByTimeAsync(999);
  assert.equal(getDaemonMeta('daemon_last_patrol_at'), null);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(getDaemonMeta('daemon_last_patrol_at'), checkedAt);
  await patrol.stop();
  assert.equal(vi.getTimerCount(), 0);
});

it('skips an occupied account immediately, logs only its slug and fixed code, and continues', async () => {
  const occupied = account();
  account('900002');
  const lock = await acquireLease('account', occupied.id);
  const ctx = context();
  const update = vi.spyOn(authStorage, 'withMerchantAuthUpdate');
  try {
    await runPatrolRound(ctx);
    assert.deepEqual(ctx.log.info.mock.calls, [[{ account: occupied.slug, code: 'patrol_account_busy' }, 'patrol: account occupied']]);
    assert.equal(ctx.log.warn.mock.calls.length, 0);
    assert.equal(update.mock.calls.length, 2);
    assert.ok(update.mock.calls.every((call) => call[2].timeoutMs === 0));
    assertLeaseOwner('account', occupied.id, lock.token);
    assert.ok(getDaemonMeta('daemon_last_patrol_at'));
  } finally { releaseLease('account', occupied.id, lock.token); }
});

it('excludes disabled merchants and consumer accounts, and never opens a fixture browser', async () => {
  account();
  const disabled = account('900002');
  updateAccount(disabled.id, { disabled: true });
  account('900003', 'consumer');
  const update = vi.spyOn(authStorage, 'withMerchantAuthUpdate');
  const launch = vi.spyOn(browser, 'withBrowser');
  await runPatrolRound(context());
  assert.deepEqual(update.mock.calls.map((call) => call[0]), [1]);
  assert.equal(launch.mock.calls.length, 0);
});

it('checks live accounts sequentially under their leases with owner tags, no navigation or verified-state write', async () => {
  const first = account();
  const second = account('900002');
  const order = [];
  const runtime = live(async (_context, _state, task) => {
    assert.equal(isInTransaction(), false);
    const row = task.expectedMallId === first.identity ? first : second;
    assert.ok(get('SELECT owner_token FROM leases WHERE scope = ? AND key = ?', 'account', String(row.id)));
    order.push(row.id);
    await Promise.resolve();
    return { verdict: 'verified', identity: { mallId: row.identity } };
  });
  await runPatrolRound(context());
  assert.deepEqual(order, [first.id, second.id]);
  assert.equal(runtime.launch.mock.calls.length, 2);
  assert.equal(runtime.launch.mock.calls[0][0].ownerTag, 'patrol-test');
  assert.deepEqual(runtime.launch.mock.calls[0][0].storageState, { cookies: [], origins: [] });
  assert.equal(runtime.session.page.goto.mock.calls.length, 0);
  assert.equal(loadAuthState(first.id).revision, 1);
  assert.equal(loadAuthState(second.id).revision, 1);
  assert.equal(get('SELECT COUNT(*) AS count FROM leases').count, 0);
});

it('records rejected live checks before reusing relogin with a pausable deadline and the same lease', async () => {
  const row = account();
  const result = { verdict: 'rejected', reason: 'login_false', checked_at: checkedAt };
  const runtime = live(async () => result);
  const attempt = vi.spyOn(relogin, 'reloginInCommand').mockImplementation(async (task, tx, instance, authResult) => {
    assertLeaseOwner('account', row.id, tx.token);
    assert.equal(instance, runtime.session.browser);
    assert.equal(authResult, result);
    assert.equal(task.runtimeConfig.passwordReloginMinIntervalMs, 1_800_000);
    assert.equal(typeof task.deadline.pause, 'function');
    assert.equal(typeof task.deadline.resume, 'function');
    assert.ok(task.signal);
    assert.ok(task.deadlineAt <= Date.now() + 120_000);
    assert.deepEqual(loadAuthState(row.id).state.merchant_auth.last_check, result);
  });
  await runPatrolRound(context());
  assert.equal(attempt.mock.calls.length, 1);
  assert.equal(loadAuthState(row.id).revision, 2);
});

it('records indeterminate live checks without relogin and continues after account failures', async () => {
  const first = account();
  const second = account('900002');
  const third = account('900003');
  live(async (_context, _state, task) => {
    if (task.expectedMallId === first.identity) return { verdict: 'indeterminate', reason: 'network_error', checked_at: checkedAt };
    if (task.expectedMallId === second.identity) throw new Error('synthetic private password');
    return { verdict: 'verified', identity: { mallId: third.identity } };
  });
  const attempt = vi.spyOn(relogin, 'reloginInCommand');
  const ctx = context();
  await runPatrolRound(ctx);
  assert.equal(loadAuthState(first.id).state.merchant_auth.last_check.verdict, 'indeterminate');
  assert.equal(attempt.mock.calls.length, 0);
  assert.deepEqual(ctx.log.warn.mock.calls.map((call) => call[0]), [
    { account: first.slug, code: 'E_AUTH_CHECK_INDETERMINATE' }, { account: second.slug, code: 'E_AUTH_UPDATE_FAILED' },
  ]);
  assert.ok(getDaemonMeta('daemon_last_patrol_at'));
});

it('stop aborts a live check mid-round, closes only its browser and leaves subsequent accounts untouched', async () => {
  account();
  account('900002');
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const runtime = live(async (_context, _state, task) => {
    entered();
    await abortableSleep(120_000, task.signal);
  });
  let finishClose;
  runtime.close.mockImplementation(() => new Promise((resolve) => { finishClose = resolve; }));
  const patrol = createPatrol({ clock: { now: Date.now, sleep: async () => {} } });
  await patrol.start(context());
  await started;
  let stopped = false;
  const stopping = (async () => { await patrol.stop(); stopped = true; })();
  await vi.waitFor(() => assert.equal(runtime.close.mock.calls.length, 1));
  assert.equal(stopped, false);
  finishClose();
  await stopping;
  assert.equal(runtime.check.mock.calls.length, 1);
  assert.deepEqual(runtime.close.mock.calls, [[runtime.session.browser]]);
  assert.equal(getDaemonMeta('daemon_last_patrol_at'), null);
  assert.equal(get('SELECT COUNT(*) AS count FROM leases').count, 0);
});

it('bounds each live account by its own 120s deadline and proceeds to the next account', async () => {
  const first = account();
  const second = account('900002');
  vi.useFakeTimers();
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const runtime = live(async (_context, _state, task) => {
    if (task.expectedMallId === second.identity) return { verdict: 'verified', identity: { mallId: second.identity } };
    entered();
    await abortableSleep(120_001, task.signal);
  });
  const ctx = context();
  const round = runPatrolRound(ctx);
  await started;
  await vi.advanceTimersByTimeAsync(120_000);
  await round;
  assert.equal(runtime.check.mock.calls.length, 2);
  assert.equal(runtime.close.mock.calls.length, 1);
  assert.deepEqual(ctx.log.warn.mock.calls[0][0], { account: first.slug, code: 'E_TIMEOUT' });
  assert.ok(getDaemonMeta('daemon_last_patrol_at'));
  assert.equal(vi.getTimerCount(), 0);
});

it('daemon abort interrupts fixture relogin, releases the lease and skips the rest of the round', async () => {
  const first = account();
  const second = account('900002');
  relogin.setAccountPassword(first.id, credential);
  relogin.setAccountPassword(second.id, credential);
  vi.stubEnv('PDD_TEST_AUTH_INVALID', '1');
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const attempt = vi.spyOn(mocks, 'mockPasswordLogin').mockImplementation(async (task) => {
    entered();
    await abortableSleep(120_000, task.signal);
  });
  const controller = new AbortController();
  const patrol = createPatrol({ clock: { now: Date.now, sleep: async () => {} } });
  await patrol.start(context({ signal: controller.signal }));
  await started;
  controller.abort();
  await patrol.stop();
  assert.equal(attempt.mock.calls.length, 1);
  assert.equal(getReloginState(second.id).last_attempt_at, null);
  assert.equal(get('SELECT COUNT(*) AS count FROM leases').count, 0);
  assert.equal(getDaemonMeta('daemon_last_patrol_at'), null);
});

it('honours fixture throttling and the breaker on later rounds', async () => {
  const row = account();
  relogin.setAccountPassword(row.id, credential);
  vi.stubEnv('PDD_TEST_AUTH_INVALID', '1');
  vi.stubEnv('PDD_TEST_PASSWORD_LOGIN', 'network_error');
  const attempt = vi.spyOn(mocks, 'mockPasswordLogin');
  const ctx = context();
  await runPatrolRound(ctx);
  await runPatrolRound(ctx);
  assert.equal(attempt.mock.calls.length, 1);
  assert.equal(getReloginState(row.id).reason, 'network_error');
  relogin.setAccountPassword(row.id, credential);
  vi.stubEnv('PDD_TEST_PASSWORD_LOGIN', 'wrong_password');
  await runPatrolRound(ctx);
  await runPatrolRound(ctx);
  assert.equal(attempt.mock.calls.length, 2);
  assert.equal(getReloginState(row.id).status, 'blocked');
});
