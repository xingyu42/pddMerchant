import assert from 'node:assert/strict';
import { beforeEach, it, vi } from 'vitest';
import { insertAccount, getCredential, putCredential, getReloginState, putReloginState,
  insertPendingAction, listPendingActions } from '../../src/infra/account-store.js';
import { get, run, transaction, isInTransaction } from '../../src/infra/db.js';
import { getLogger } from '../../src/infra/logger.js';
import { savePasswordCredential, deletePasswordCredential } from '../../src/adapter/password-credential.js';
import { withMerchantAuthUpdate } from '../../src/adapter/merchant-auth-storage.js';
import { assertMerchantVerified } from '../../src/adapter/merchant-auth.js';
import { decideRelogin, recordReloginAttempt, recordReloginOutcome, markManualLoginSucceeded,
  setAccountPassword, clearAccountPassword, clearReloginBlock, recordTakeoverTimeout, getReloginSummary } from '../../src/services/password-relogin.js';

const credential = { loginName: 'synthetic-login-54639', password: 'synthetic-password-183646' };
const now = Date.parse('2026-10-27T00:00:00.000Z');
const minIntervalMs = 1_800_000;
let account;
beforeEach(() => { account = insertAccount({ identity: '1', displayName: 'Shop' }); });

function seedState(changes = {}) {
  putReloginState(account.id, { status: 'available', reason: 'network_error', lastAttemptAt: new Date(now - 1000).toISOString(), ...changes });
}

function decide(time = now) {
  return decideRelogin(account.id, { now: time, minIntervalMs });
}

function openActions() {
  return listPendingActions(account.id).filter((action) => action.status === 'open');
}

function safeError(error, code) {
  assert.equal(error.code, code);
  assert.equal(error.exitCode, 3);
  const output = `${error.message} ${error.hint} ${JSON.stringify(error.detail)}`;
  for (const value of Object.values(credential)) assert.equal(output.includes(value), false);
}

it.each(['available', 'blocked', 'awaiting_human'])('checks missing credentials before %s and preserves the merchant expiry error', (status) => {
  seedState({ status });
  const result = decide();
  assert.equal(result.action, 'fail');
  safeError(result.error, 'E_AUTH_EXPIRED');
  assert.throws(() => assertMerchantVerified({ verdict: 'rejected', reason: 'auth_missing' }), (expected) => {
    assert.equal(result.error.message, expected.message);
    assert.equal(result.error.hint, expected.hint);
    assert.deepEqual(result.error.detail, expected.detail);
    return true;
  });
});

it.each([
  ['blocked', 'wrong_password', 'E_AUTH_RELOGIN_BLOCKED', 'reason'],
  ['awaiting_human', 'slider', 'E_AUTH_HUMAN_REQUIRED', 'challenge'],
])('checks %s before throttle without decrypting', (status, reason, code, key) => {
  putCredential(account.id, 'damaged ciphertext');
  seedState({ status, reason });
  const result = decide();
  safeError(result.error, code);
  assert.deepEqual(result.error.detail, { account: account.slug, [key]: reason });
});

it.each([
  ['success', 'E_AUTH_EXPIRED'], ['form_changed', 'E_PASSWORD_LOGIN_FORM_CHANGED'],
  ['network_error', 'E_AUTH_RELOGIN_FAILED'], ['verify_failed', 'E_AUTH_RELOGIN_FAILED'],
  ['password_reset', 'E_AUTH_RELOGIN_FAILED'],
])('restores throttled %s category without decrypting', (reason, code) => {
  putCredential(account.id, 'damaged ciphertext');
  seedState({ reason });
  const result = decide();
  safeError(result.error, code);
  assert.deepEqual(result.error.detail, { account: account.slug, reason, relogin: 'throttled', next_attempt_at: '2026-10-27 08:29:59' });
});

it('decrypts only an attempt and returns its credential version at the exact interval boundary', () => {
  savePasswordCredential(account.id, credential);
  assert.deepEqual(decide(), { action: 'attempt', credential, credentialUpdatedAt: getCredential(account.id).updated_at });
  seedState();
  assert.equal(decide(now + minIntervalMs - 1001).action, 'fail');
  assert.equal(decide(now + minIntervalMs - 1000).action, 'attempt');
  putCredential(account.id, 'damaged ciphertext');
  assert.throws(() => decide(now + minIntervalMs), { code: 'E_SECRET_DECRYPT_FAILED' });
});

it('uses Date.now when the decision time is omitted', () => {
  savePasswordCredential(account.id, credential);
  seedState();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  assert.equal(decideRelogin(account.id, { minIntervalMs }).action, 'fail');
});

it('throttles a crashed first attempt with a null previous reason', async () => {
  savePasswordCredential(account.id, credential);
  await withMerchantAuthUpdate(account.id, (tx) => recordReloginAttempt(tx));
  const result = decideRelogin(account.id, { minIntervalMs });
  safeError(result.error, 'E_AUTH_RELOGIN_FAILED');
  assert.equal(result.error.detail.reason, null);
  assert.equal(result.error.detail.relogin, 'throttled');
});

it('records an attempt before browser work, creating a default row and preserving existing state', async () => {
  await withMerchantAuthUpdate(account.id, (tx) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    recordReloginAttempt(tx);
    assert.deepEqual(getReloginSummary(account.id), { has_password: false, status: 'available', reason: null, last_attempt_at: new Date(now).toISOString() });
    seedState({ status: 'blocked', reason: 'wrong_password', consecutiveTakeoverTimeouts: 1 });
    recordReloginAttempt(tx);
    const state = getReloginState(account.id);
    assert.equal(state.status, 'blocked');
    assert.equal(state.reason, 'wrong_password');
    assert.equal(state.consecutive_takeover_timeouts, 1);
    assert.equal(state.last_attempt_at, new Date(now).toISOString());
    vi.useRealTimers();
  });
});

const outcomes = [
  [{ outcome: 'success' }, 'available', 'success', null, null],
  ...['sms', 'slider', 'click', 'risk_confirm', 'unknown'].map((challenge) => [
    { outcome: 'challenge', challenge }, 'awaiting_human', challenge, 'human_takeover', 'E_AUTH_HUMAN_REQUIRED',
  ]),
  ...['wrong_password', 'account_locked'].map((outcome) => [
    { outcome }, 'blocked', outcome, 'relogin_blocked', 'E_AUTH_RELOGIN_BLOCKED',
  ]),
  ...['form_changed', 'network_error', 'verify_failed'].map((outcome) => [
    { outcome }, 'available', outcome, null, outcome === 'form_changed' ? 'E_PASSWORD_LOGIN_FORM_CHANGED' : 'E_AUTH_RELOGIN_FAILED',
  ]),
];

it.each(outcomes)('applies outcome %j atomically', async (outcome, status, reason, kind, code) => {
  savePasswordCredential(account.id, credential);
  seedState({ consecutiveTakeoverTimeouts: 1 });
  const credentialUpdatedAt = getCredential(account.id).updated_at;
  await withMerchantAuthUpdate(account.id, (tx) => {
    const error = recordReloginOutcome(tx, outcome, { credentialUpdatedAt });
    if (code) {
      safeError(error, code);
      assert.deepEqual(error.detail, { account: account.slug, [kind === 'human_takeover' ? 'challenge' : 'reason']: reason });
    } else assert.equal(error, null);
  });
  const state = getReloginState(account.id);
  assert.equal(state.status, status);
  assert.equal(state.reason, reason);
  assert.equal(state.consecutive_takeover_timeouts, reason === 'success' ? 0 : 1);
  assert.equal(state.last_attempt_at, new Date(now - 1000).toISOString());
  assert.deepEqual(openActions().map((action) => [action.kind, action.reason]), kind ? [[kind, reason]] : []);
});

it.each(['human_takeover', 'relogin_blocked'])('retains the existing open %s action', async (kind) => {
  savePasswordCredential(account.id, credential);
  const credentialUpdatedAt = getCredential(account.id).updated_at;
  const actionId = insertPendingAction(account.id, { kind, reason: 'original' });
  const outcome = kind === 'human_takeover' ? { outcome: 'challenge', challenge: 'sms' } : { outcome: 'wrong_password' };
  await withMerchantAuthUpdate(account.id, (tx) => {
    recordReloginOutcome(tx, outcome, { credentialUpdatedAt });
    recordReloginOutcome(tx, outcome, { credentialUpdatedAt });
  });
  assert.equal(openActions().length, 1);
  assert.equal(openActions()[0].id, actionId);
  assert.equal(openActions()[0].reason, 'original');
});

it.each(['reset', 'clear'])('ignores old challenge/blocked transitions after password %s with a safe warning', async (change) => {
  savePasswordCredential(account.id, credential);
  const credentialUpdatedAt = getCredential(account.id).updated_at;
  const warning = vi.spyOn(getLogger(), 'warn').mockImplementation(() => {});
  await withMerchantAuthUpdate(account.id, (tx) => {
    if (change === 'reset') setAccountPassword(account.id, credential);
    else clearAccountPassword(account.id);
    const before = getReloginState(account.id);
    for (const outcome of [{ outcome: 'challenge', challenge: 'sms' }, { outcome: 'wrong_password' }, { outcome: 'account_locked' }]) {
      const error = recordReloginOutcome(tx, outcome, { credentialUpdatedAt });
      assert.equal(error.exitCode, 3);
      assert.deepEqual(getReloginState(account.id), before);
      assert.deepEqual(openActions(), []);
    }
  });
  assert.equal(warning.mock.calls.length, 3);
  for (const [detail] of warning.mock.calls) assert.deepEqual(detail, { code: 'password_relogin_stale_outcome' });
});

it('changes credential versions even when passwords are reset in the same millisecond', () => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  setAccountPassword(account.id, credential);
  const original = getCredential(account.id).updated_at;
  setAccountPassword(account.id, credential);
  assert.ok(getCredential(account.id).updated_at > original);
});

it('ignores blocking outcomes when both the saved credential and expected version are absent', async () => {
  const warning = vi.spyOn(getLogger(), 'warn').mockImplementation(() => {});
  await withMerchantAuthUpdate(account.id, (tx) => {
    recordReloginOutcome(tx, 'wrong_password', { credentialUpdatedAt: undefined });
  });
  assert.equal(getReloginState(account.id), null);
  assert.deepEqual(openActions(), []);
  assert.equal(warning.mock.calls.length, 1);
});

it.each(['missing', 'stolen'])('rejects record writes for a %s lease and writes nothing', async (lease) => {
  savePasswordCredential(account.id, credential);
  const credentialUpdatedAt = getCredential(account.id).updated_at;
  const check = (tx) => {
    assert.throws(() => recordReloginAttempt(tx), { code: 'E_AUTH_LOCK_LOST' });
    assert.throws(() => recordReloginOutcome(tx, { outcome: 'wrong_password' }, { credentialUpdatedAt }), { code: 'E_AUTH_LOCK_LOST' });
    assert.equal(getReloginState(account.id), null);
    assert.deepEqual(openActions(), []);
  };
  if (lease === 'missing') check({ accountId: account.id, token: 'missing' });
  else await withMerchantAuthUpdate(account.id, (tx) => check({ ...tx, token: 'stolen' }));
});

it('rolls back the state update when inserting its pending action fails', async () => {
  savePasswordCredential(account.id, credential);
  run(`CREATE TRIGGER reject_action BEFORE INSERT ON pending_actions
    BEGIN SELECT RAISE(ABORT, 'synthetic private native error'); END`);
  await withMerchantAuthUpdate(account.id, (tx) => {
    assert.throws(() => recordReloginOutcome(tx, 'wrong_password', { credentialUpdatedAt: getCredential(account.id).updated_at }),
      { code: 'E_AUTH_ACCOUNT_SAVE_FAILED', message: '账号存储暂不可用' });
  });
  assert.equal(getReloginState(account.id), null);
  assert.deepEqual(openActions(), []);
});

it('normalizes unknown challenges and rejects unknown outcomes without storing values', async () => {
  savePasswordCredential(account.id, credential);
  await withMerchantAuthUpdate(account.id, (tx) => {
    const version = { credentialUpdatedAt: getCredential(account.id).updated_at };
    assert.throws(() => recordReloginOutcome(tx, { outcome: credential.password }, version), { code: 'E_USAGE' });
    assert.equal(getReloginState(account.id), null);
    const error = recordReloginOutcome(tx, { outcome: 'challenge', challenge: credential.password }, version);
    assert.equal(error.detail.challenge, 'unknown');
    assert.equal(getReloginState(account.id).reason, 'unknown');
  });
});

it.each([false, true])('manual login resolves only awaiting-human actions (outer transaction: %s)', (outer) => {
  seedState({ status: 'awaiting_human', reason: 'sms', consecutiveTakeoverTimeouts: 1 });
  insertPendingAction(account.id, { kind: 'human_takeover', reason: 'sms' });
  insertPendingAction(account.id, { kind: 'relogin_blocked', reason: 'wrong_password' });
  if (outer) transaction(() => { assert.equal(isInTransaction(), true); markManualLoginSucceeded(account.id); });
  else markManualLoginSucceeded(account.id);
  const state = getReloginState(account.id);
  assert.equal(state.status, 'available');
  assert.equal(state.reason, 'manual_login');
  assert.equal(state.consecutive_takeover_timeouts, 1);
  assert.deepEqual(openActions().map((action) => action.kind), ['relogin_blocked']);
});

it.each(['blocked', 'available', 'missing'])('manual login leaves %s state and actions untouched', (status) => {
  if (status !== 'missing') seedState({ status });
  insertPendingAction(account.id, { kind: 'human_takeover', reason: 'sms' });
  const before = getReloginState(account.id);
  markManualLoginSucceeded(account.id);
  assert.deepEqual(getReloginState(account.id), before);
  assert.equal(openActions().length, 1);
});

it('manual login changes participate in an outer rollback', () => {
  seedState({ status: 'awaiting_human', reason: 'sms' });
  insertPendingAction(account.id, { kind: 'human_takeover', reason: 'sms' });
  assert.throws(() => transaction(() => { markManualLoginSucceeded(account.id); throw new Error('rollback'); }));
  assert.equal(getReloginState(account.id).status, 'awaiting_human');
  assert.equal(openActions().length, 1);
});

it('sets a password and resets state, attempt time, timeout count and every open action', () => {
  seedState({ status: 'blocked', reason: 'takeover_timeout', consecutiveTakeoverTimeouts: 2 });
  for (const kind of ['human_takeover', 'relogin_blocked']) insertPendingAction(account.id, { kind, reason: 'unknown' });
  setAccountPassword(account.id, credential);
  assert.deepEqual(getReloginSummary(account.id), { has_password: true, status: 'available', reason: 'password_reset', last_attempt_at: null });
  assert.equal(getReloginState(account.id).consecutive_takeover_timeouts, 0);
  assert.deepEqual(openActions(), []);
  assert.equal(decide().action, 'attempt');
});

it('rolls back credential and state changes when resolving actions fails', () => {
  insertPendingAction(account.id, { kind: 'human_takeover', reason: 'sms' });
  run(`CREATE TRIGGER reject_resolve BEFORE UPDATE ON pending_actions
    BEGIN SELECT RAISE(ABORT, 'private'); END`);
  assert.throws(() => setAccountPassword(account.id, credential), { code: 'E_AUTH_ACCOUNT_SAVE_FAILED' });
  assert.equal(getCredential(account.id), null);
  assert.equal(getReloginState(account.id), null);
  assert.equal(openActions().length, 1);
  assert.ok(get("SELECT value FROM meta WHERE key = 'master_key_fingerprint'"));
});

it('clears a password, resolves all actions and restores available state', () => {
  savePasswordCredential(account.id, credential);
  seedState({ status: 'blocked', reason: 'wrong_password' });
  for (const kind of ['human_takeover', 'relogin_blocked']) insertPendingAction(account.id, { kind, reason: 'unknown' });
  clearAccountPassword(account.id);
  assert.equal(getCredential(account.id), null);
  assert.equal(getReloginSummary(account.id).status, 'available');
  assert.equal(getReloginSummary(account.id).reason, 'password_cleared');
  assert.deepEqual(openActions(), []);
  safeError(decide().error, 'E_AUTH_EXPIRED');
  clearAccountPassword(account.id);
});

it('unblocks only blocked accounts, clears the attempt time and resolves only block actions', () => {
  seedState({ status: 'awaiting_human', reason: 'sms' });
  const before = getReloginState(account.id);
  clearReloginBlock(account.id);
  assert.deepEqual(getReloginState(account.id), before);
  seedState({ status: 'blocked', reason: 'wrong_password' });
  for (const kind of ['human_takeover', 'relogin_blocked']) insertPendingAction(account.id, { kind, reason: 'unknown' });
  clearReloginBlock(account.id);
  assert.deepEqual(getReloginSummary(account.id), { has_password: false, status: 'available', reason: 'manual_unblock', last_attempt_at: null });
  assert.deepEqual(openActions().map((action) => action.kind), ['human_takeover']);
});

it('counts takeover timeouts and blocks at two, keeping one block action across repeats', () => {
  seedState({ status: 'awaiting_human', reason: 'sms' });
  recordTakeoverTimeout(account.id);
  assert.equal(getReloginState(account.id).consecutive_takeover_timeouts, 1);
  assert.equal(getReloginState(account.id).status, 'awaiting_human');
  assert.equal(getReloginState(account.id).reason, 'sms');
  assert.deepEqual(openActions(), []);
  recordTakeoverTimeout(account.id);
  const action = openActions()[0];
  assert.equal(getReloginState(account.id).status, 'blocked');
  assert.equal(getReloginState(account.id).reason, 'takeover_timeout');
  recordTakeoverTimeout(account.id);
  assert.equal(getReloginState(account.id).consecutive_takeover_timeouts, 3);
  assert.deepEqual(openActions(), [action]);
  setAccountPassword(account.id, credential);
  recordTakeoverTimeout(account.id);
  assert.equal(getReloginState(account.id).status, 'available');
});

it('starts a fresh timeout window after manually clearing a block', () => {
  recordTakeoverTimeout(account.id);
  recordTakeoverTimeout(account.id);
  assert.equal(getReloginState(account.id).status, 'blocked');
  clearReloginBlock(account.id);
  assert.equal(getReloginState(account.id).status, 'available');
  assert.equal(getReloginState(account.id).consecutive_takeover_timeouts, 0);
  recordTakeoverTimeout(account.id);
  assert.equal(getReloginState(account.id).status, 'available');
  assert.equal(getReloginState(account.id).consecutive_takeover_timeouts, 1);
  assert.deepEqual(openActions(), []);
});

it('preserves an existing wrong-password block and action across two takeover timeouts', () => {
  seedState({ status: 'blocked', reason: 'wrong_password' });
  insertPendingAction(account.id, { kind: 'relogin_blocked', reason: 'wrong_password' });
  const actions = openActions();
  assert.equal(actions.length, 1);
  recordTakeoverTimeout(account.id);
  recordTakeoverTimeout(account.id);
  const state = getReloginState(account.id);
  assert.equal(state.status, 'blocked');
  assert.equal(state.reason, 'wrong_password');
  assert.equal(state.consecutive_takeover_timeouts, 2);
  assert.deepEqual(openActions(), actions);
});

it('reports summary defaults and stored values without decrypting credentials', () => {
  assert.deepEqual(getReloginSummary(account.id), { has_password: false, status: 'available', reason: null, last_attempt_at: null });
  clearReloginBlock(account.id);
  assert.equal(getReloginState(account.id), null);
  putCredential(account.id, 'damaged ciphertext');
  seedState({ status: 'blocked', reason: 'wrong_password' });
  assert.deepEqual(getReloginSummary(account.id), { has_password: true, status: 'blocked', reason: 'wrong_password', last_attempt_at: new Date(now - 1000).toISOString() });
});

it('creates the first timeout state and does not recreate deleted accounts', () => {
  recordTakeoverTimeout(account.id);
  assert.equal(getReloginState(account.id).consecutive_takeover_timeouts, 1);
  deletePasswordCredential(account.id);
  run('DELETE FROM accounts WHERE id = ?', account.id);
  for (const callback of [() => setAccountPassword(account.id, credential), () => clearAccountPassword(account.id),
    () => clearReloginBlock(account.id), () => recordTakeoverTimeout(account.id), () => getReloginSummary(account.id)]) {
    assert.throws(callback, { code: 'E_ACCOUNT_NOT_FOUND' });
  }
  assert.equal(get('SELECT COUNT(*) AS count FROM relogin_states').count, 0);
});
