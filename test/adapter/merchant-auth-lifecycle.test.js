import assert from 'node:assert/strict';
import https from 'node:https';
import { insertAccount } from '../../src/infra/account-store.js';
import { loadAuthState, saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { mockMerchantProbeTransport } from '../helpers/merchant-probe-transport.js';
import { savePasswordCredential } from '../../src/adapter/password-credential.js';
import { getReloginState, listPendingActions } from '../../src/infra/account-store.js';
import { TIMEOUTS } from '../../src/infra/timeouts.js';

const control = vi.hoisted(() => ({ state: null, mallId: 900001, selectedMallId: 900001, login: true, malformed: false,
  page: null, browserCalls: 0, outcome: null, snapshots: [], originalContext: null, failPage: false, candidateState: null }));
vi.mock('../../src/adapter/mall-reader.js', () => ({ resolveMallContext: async () => ({ activeId: String(control.selectedMallId), malls: [] }) }));
vi.mock('../../src/adapter/browser.js', () => ({
  withBrowser: async (_options, fn) => {
    control.browserCalls++;
    control.page = { goto: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const browser = {};
    const context = { storageState: async () => structuredClone(control.state), browser: () => browser, close: vi.fn(async () => {}) };
    control.originalContext = context;
    return fn({ browser, context, page: control.page });
  },
  createSnapshotContext: async (browser, state) => {
    const session = structuredClone(state);
    const context = {
      session, cookies: async () => structuredClone(session.cookies), close: vi.fn(async () => {}),
      storageState: async () => structuredClone(session), browser: () => browser,
      newPage: vi.fn(async () => {
        if (control.failPage) throw new Error('synthetic private browser error');
        return { context: () => context, close: vi.fn(async () => {}), goto: vi.fn(async () => {}) };
      }),
    };
    control.snapshots.push({ input: structuredClone(state), context });
    return context;
  },
}));
vi.mock('../../src/adapter/password-login.js', () => ({
  attemptPasswordLogin: vi.fn(async (page, _credential, task) => {
    assert.ok(task.deadlineAt - Date.now() > 60000);
    assert.ok(task.deadlineAt - Date.now() <= TIMEOUTS.LOGIN_PASSWORD - TIMEOUTS.LOGIN_PASSWORD_RESERVE);
    if (control.outcome?.outcome === 'success') {
      page.context().session.cookies.push({ name: 'PASS_ID', value: 'synthetic-new-session' });
      control.candidateState = structuredClone(page.context().session);
      control.login = true;
    }
    return control.outcome;
  }),
}));
import { executeSingle } from '../../src/commands/runner/single-lifecycle.js';
import { attemptPasswordLogin } from '../../src/adapter/password-login.js';

let accountId;
beforeEach(async () => {
  vi.stubEnv('PDD_TEST_ADAPTER', '');
  accountId = insertAccount({ identity: '900001', displayName: 'Shop' }, { setDefault: true }).id;
  control.state = { cookies: [{ name: 'PASS_ID', value: 'synthetic' }], origins: [] };
  control.mallId = 900001; control.selectedMallId = 900001; control.login = true; control.malformed = false; control.browserCalls = 0;
  control.outcome = null; control.snapshots = []; control.failPage = false; control.candidateState = null;
  attemptPasswordLogin.mockClear();
  saveAuthStateSnapshot(control.state, accountId);
  mockMerchantProbeTransport(() => ({ mallId: control.mallId, mallName: 'Shop', login: control.login, malformed: control.malformed }));
});

async function runOperation(run, opts = {}) {
  return executeSingle({ name: 'test.readonly', needsAuth: true, needsMall: 'none', run },
    { accountId, timeoutMs: 5000, ...opts }, { emitResult: false, runtimeConfig: { rateLimitQps: 3, rateLimitBurst: 3, cooldownThreshold: 3, cooldownMs: 1000,
      passwordReloginMinIntervalMs: 1800000 } });
}

describe('live merchant command authentication lifecycle', () => {
  it('verifies before business execution and saves the final verified snapshot', async () => {
    const envelope = await runOperation(async () => ({ receipt: 'complete' }));
    assert.equal(envelope.ok, true);
    assert.deepEqual(envelope.meta.warnings, []);
    assert.equal(loadAuthState(accountId).state.merchant_auth.mall_id, '900001');
  });

  it('does not run business when login is unconfirmed, and preserves old cookies', async () => {
    control.malformed = true;
    const run = vi.fn(async () => ({}));
    const envelope = await runOperation(run);
    assert.equal(envelope.error.code, 'E_AUTH_CHECK_INDETERMINATE');
    assert.equal(envelope.meta.exit_code, 5);
    assert.equal(run.mock.calls.length, 0);
    const saved = loadAuthState(accountId).state;
    assert.deepEqual(saved.cookies, control.state.cookies);
    assert.equal(saved.merchant_auth.last_check.verdict, 'indeterminate');
  });

  it('marks rejection without replacing cookies or repeatedly sending rejected material', async () => {
    control.login = false;
    const run = vi.fn(async () => ({}));
    const first = await runOperation(run);
    assert.equal(first.error.code, 'E_AUTH_EXPIRED');
    assert.equal(first.meta.exit_code, 3);
    const saved = loadAuthState(accountId).state;
    assert.deepEqual(saved.cookies, control.state.cookies);
    assert.equal(saved.merchant_auth.last_check.verdict, 'rejected');
    const requests = https.request.mock.calls.length;
    control.login = true;
    const second = await runOperation(run);
    assert.equal(second.error.code, 'E_AUTH_EXPIRED');
    assert.equal(https.request.mock.calls.length, requests);
    assert.equal(run.mock.calls.length, 0);
  });

  it.each([['login_false', 200], ['known_rejected', null]])('preserves the live %s check detail without password credentials', async (reason, httpStatus) => {
    control.login = false;
    if (reason === 'known_rejected') {
      saveAuthStateSnapshot({ ...control.state, merchant_auth: { version: 1, mall_id: '900001',
        last_check: { verdict: 'rejected', reason: 'login_false', checked_at: new Date().toISOString() } } }, accountId);
    }
    const run = vi.fn();
    const result = await runOperation(run);
    assert.equal(result.error.code, 'E_AUTH_EXPIRED');
    assert.deepEqual(result.error.detail, { reason, verdict: 'rejected', http_status: httpStatus });
    assert.match(result.error.hint, /pdd login/);
    assert.equal(run.mock.calls.length, 0);
    assert.equal(attemptPasswordLogin.mock.calls.length, 0);
    assert.equal(getReloginState(accountId), null);
  });

  it('preserves a bound file when the checked shop differs', async () => {
    const before = { ...control.state, merchant_auth: { version: 1, mall_id: '900002' } };
    saveAuthStateSnapshot(before, accountId);
    const run = vi.fn(async () => ({}));
    const result = await runOperation(run);
    assert.equal(result.error.code, 'E_ACCOUNT_IDENTITY_MISMATCH');
    assert.equal(result.meta.exit_code, 3);
    assert.equal(loadAuthState(accountId).state.merchant_auth.mall_id, before.merchant_auth.mall_id);
    assert.equal(run.mock.calls.length, 0);
  });

  it('keeps business success when the final verification is unconfirmed', async () => {
    const envelope = await runOperation(async () => { control.malformed = true; return { receipt: 'complete' }; });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.receipt, 'complete');
    assert.ok(envelope.meta.warnings.includes('auth_state_persist_unverified'));
    assert.ok(!loadAuthState(accountId).state.merchant_auth);
  });

  it('does not persist a switched shop into the original account', async () => {
    const envelope = await runOperation(async () => { control.mallId = 900002; return { receipt: 'complete' }; });
    assert.equal(envelope.ok, true);
    assert.ok(envelope.meta.warnings.includes('auth_state_identity_mismatch'));
    assert.deepEqual(loadAuthState(accountId).state, control.state);
  });

  it('does not overwrite a newer external version after business success', async () => {
    const newer = { ...control.state, origins: [{ origin: 'https://mms.pinduoduo.com', localStorage: [] }] };
    const envelope = await runOperation(async () => { saveAuthStateSnapshot(newer, accountId); return { receipt: 'complete' }; });
    assert.equal(envelope.ok, true);
    assert.ok(envelope.meta.warnings.includes('auth_state_persist_conflict'));
    assert.deepEqual(loadAuthState(accountId).state, newer);
  });

  it('skips switched shop persistence even if the subject endpoint still reports the original shop', async () => {
    control.selectedMallId = 900002;
    const envelope = await executeSingle({ name: 'test.switched', needsAuth: true, needsMall: 'current', run: async () => ({ receipt: 'complete' }) },
      { accountId, timeoutMs: 5000 }, { emitResult: false, runtimeConfig: { rateLimitQps: 3, rateLimitBurst: 3, cooldownThreshold: 3, cooldownMs: 1000 } });
    assert.equal(envelope.ok, true);
    assert.ok(envelope.meta.warnings.includes('auth_state_identity_mismatch'));
    assert.deepEqual(loadAuthState(accountId).state, control.state);
  });

  it('keeps a business receipt if closing the page for persistence fails', async () => {
    const envelope = await runOperation(async (ctx) => {
      ctx.page.close.mockRejectedValueOnce(new Error('synthetic-secret'));
      return { receipt: 'complete' };
    });
    assert.equal(envelope.ok, true);
    assert.ok(envelope.meta.warnings.includes('auth_state_persist_failed'));
    assert.ok(!JSON.stringify(envelope).includes('synthetic-secret'));
  });

  it('relogs from stored device state without PASS_ID and replaces the business context and page', async () => {
    const device = { name: 'device_id', value: 'synthetic-trusted-device' };
    const origins = [{ origin: 'https://mms.pinduoduo.com', localStorage: [{ name: 'device', value: 'synthetic-device' }] }];
    const saved = { cookies: [...control.state.cookies, { name: 'PASS_ID', value: 'other-scope', path: '/other' }, device], origins };
    saveAuthStateSnapshot(saved, accountId);
    // The transaction snapshot differs from the active context; relogin must use the transaction.
    control.login = false;
    control.outcome = { outcome: 'success' };
    savePasswordCredential(accountId, { loginName: 'synthetic-login', password: 'synthetic-password' });
    const result = await runOperation(async (ctx) => {
      assert.notEqual(ctx.context, control.originalContext);
      assert.notEqual(ctx.page, control.page);
      assert.equal(control.originalContext.close.mock.calls.length, 1);
      assert.equal(ctx.deadlineAt > Date.now(), true);
      assert.equal(ctx.signal.aborted, false);
      assert.ok(ctx.context.session.cookies.some((cookie) => cookie.value === 'synthetic-new-session'));
      return { receipt: 'recovered' };
    });
    assert.equal(result.ok, true);
    assert.equal(attemptPasswordLogin.mock.calls.length, 1);
    const loginContext = control.snapshots.find((entry) => entry.context.newPage.mock.calls.length > 0);
    assert.deepEqual(loginContext.input, { cookies: [device], origins });
    assert.deepEqual(saved.cookies.filter((cookie) => cookie.name === 'PASS_ID').length, 2);
    assert.equal(loginContext.context.newPage.mock.calls.length, 2);
    assert.equal(loadAuthState(accountId).state.merchant_auth.check_verdict, 'verified');
    assert.deepEqual(loadAuthState(accountId).state.cookies, control.candidateState.cookies);
    assert.equal(getReloginState(accountId).reason, 'success');
    assert.deepEqual(result.meta.warnings, []);
  });

  it('records a live challenge, closes the replacement and attaches its action warning', async () => {
    control.login = false;
    control.outcome = { outcome: 'challenge', challenge: 'slider' };
    savePasswordCredential(accountId, { loginName: 'synthetic-login', password: 'synthetic-password' });
    const run = vi.fn();
    const result = await runOperation(run);
    assert.equal(result.error.code, 'E_AUTH_HUMAN_REQUIRED');
    assert.equal(run.mock.calls.length, 0);
    assert.equal(control.snapshots.at(-1).context.close.mock.calls.length, 1);
    assert.deepEqual(result.meta.warnings, [{ code: 'account_action_required', account: 'shop', reason: 'slider' }]);
    assert.equal(listPendingActions(accountId)[0].status, 'open');
    assert.equal(loadAuthState(accountId).state.merchant_auth.last_check.verdict, 'rejected');
  });

  it('records an unknown challenge at the adapter deadline within the full relogin budget', async () => {
    control.login = false;
    savePasswordCredential(accountId, { loginName: 'synthetic-login', password: 'synthetic-password' });
    vi.useFakeTimers();
    let reloginDeadline;
    attemptPasswordLogin.mockImplementationOnce(async (_page, _credential, task) => {
      reloginDeadline = Date.parse(getReloginState(accountId).last_attempt_at) + TIMEOUTS.LOGIN_PASSWORD;
      await vi.advanceTimersByTimeAsync(task.deadlineAt - Date.now());
      assert.equal(Date.now(), task.deadlineAt);
      return { outcome: 'challenge', challenge: 'unknown' };
    });
    const run = vi.fn();
    try {
      const result = await runOperation(run);
      assert.equal(result.error.code, 'E_AUTH_HUMAN_REQUIRED');
      assert.equal(result.error.detail.challenge, 'unknown');
      assert.equal(result.meta.exit_code, 3);
      assert.equal(attemptPasswordLogin.mock.calls.length, 1);
      const task = attemptPasswordLogin.mock.calls[0][2];
      assert.equal(TIMEOUTS.LOGIN_PASSWORD_RESERVE, 20_000);
      assert.equal(task.deadlineAt, reloginDeadline - 20_000);
      assert.equal(task.signal.aborted, false);
      const state = getReloginState(accountId);
      assert.equal(state.status, 'awaiting_human');
      assert.equal(state.reason, 'unknown');
      const actions = listPendingActions(accountId).filter((action) => action.status === 'open');
      assert.deepEqual(actions.map((action) => [action.kind, action.reason]), [['human_takeover', 'unknown']]);
      assert.deepEqual(result.meta.warnings, [{ code: 'account_action_required', account: 'shop', reason: 'unknown' }]);
      assert.equal(run.mock.calls.length, 0);
      assert.equal(control.snapshots.at(-1).context.close.mock.calls.length, 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['identity_mismatch', 'indeterminate'])('rejects a successful password submission with %s verification', async (failure) => {
    control.login = false;
    control.outcome = { outcome: 'success' };
    if (failure === 'identity_mismatch') control.mallId = 900002;
    else control.malformed = true;
    // Preserve a known rejection so the independent check fails only after password submission.
    saveAuthStateSnapshot({ ...control.state, merchant_auth: { version: 1, mall_id: '900001',
      last_check: { verdict: 'rejected', reason: 'login_false', checked_at: new Date().toISOString() } } }, accountId);
    savePasswordCredential(accountId, { loginName: 'synthetic-login', password: 'synthetic-password' });
    const run = vi.fn();
    const result = await runOperation(run);
    assert.equal(result.error.code, failure === 'identity_mismatch' ? 'E_ACCOUNT_IDENTITY_MISMATCH' : 'E_AUTH_RELOGIN_FAILED');
    assert.equal(getReloginState(accountId).reason, 'verify_failed');
    assert.equal(getReloginState(accountId).status, 'available');
    assert.equal(run.mock.calls.length, 0);
    const loginContext = control.snapshots.find((entry) => entry.context.newPage.mock.calls.length > 0);
    assert.equal(loginContext.context.close.mock.calls.length, 1);
    assert.deepEqual(loadAuthState(accountId).state.cookies, control.state.cookies);
  });

  it('closes a partial relogin context and sanitizes page creation failures', async () => {
    control.login = false;
    control.failPage = true;
    savePasswordCredential(accountId, { loginName: 'synthetic-login', password: 'synthetic-password' });
    const result = await runOperation(vi.fn());
    assert.equal(result.error.code, 'E_AUTH_RELOGIN_FAILED');
    assert.equal(control.snapshots.at(-1).context.close.mock.calls.length, 1);
    assert.equal(JSON.stringify(result).includes('synthetic private browser error'), false);
    assert.equal(getReloginState(accountId).reason, 'network_error');
  });

  it('responds to parent cancellation while relogin has paused the command deadline', async () => {
    control.login = false;
    const parent = new AbortController();
    savePasswordCredential(accountId, { loginName: 'synthetic-login', password: 'synthetic-password' });
    attemptPasswordLogin.mockImplementationOnce(async (_page, _credential, task) => {
      parent.abort();
      assert.equal(task.signal.aborted, true);
      return { outcome: 'success' };
    });
    const result = await runOperation(vi.fn(), { signal: parent.signal });
    assert.equal(result.error.code, 'E_AUTH_CANCELLED');
    assert.ok(control.snapshots.at(-1).context.close.mock.calls.length > 0);
    assert.equal(getReloginState(accountId).reason, null);
    assert.deepEqual(listPendingActions(accountId), []);
    assert.deepEqual(loadAuthState(accountId).state.cookies, control.state.cookies);
  });
});
