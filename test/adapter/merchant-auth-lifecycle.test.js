import assert from 'node:assert/strict';
import https from 'node:https';
import { insertAccount } from '../../src/infra/account-store.js';
import { loadAuthState, saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { mockMerchantProbeTransport } from '../helpers/merchant-probe-transport.js';

const control = vi.hoisted(() => ({ state: null, mallId: 900001, selectedMallId: 900001, login: true, malformed: false, page: null, browserCalls: 0 }));
vi.mock('../../src/adapter/mall-reader.js', () => ({ resolveMallContext: async () => ({ activeId: String(control.selectedMallId), malls: [] }) }));
vi.mock('../../src/adapter/browser.js', () => ({
  withBrowser: async (_options, fn) => {
    control.browserCalls++;
    control.page = { goto: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const context = { storageState: async () => structuredClone(control.state), browser: () => ({}) };
    return fn({ context, page: control.page });
  },
  createSnapshotContext: async (_browser, state) => ({ cookies: async () => structuredClone(state.cookies), close: async () => {} }),
}));
import { executeSingle } from '../../src/commands/runner/single-lifecycle.js';

let accountId;
beforeEach(async () => {
  vi.stubEnv('PDD_TEST_ADAPTER', '');
  accountId = insertAccount({ identity: '900001', displayName: 'Shop' }, { setDefault: true }).id;
  control.state = { cookies: [{ name: 'PASS_ID', value: 'synthetic' }], origins: [] };
  control.mallId = 900001; control.selectedMallId = 900001; control.login = true; control.malformed = false; control.browserCalls = 0;
  saveAuthStateSnapshot(control.state, accountId);
  mockMerchantProbeTransport(() => ({ mallId: control.mallId, mallName: 'Shop', login: control.login, malformed: control.malformed }));
});

async function runOperation(run) {
  return executeSingle({ name: 'test.readonly', needsAuth: true, needsMall: 'none', run },
    { accountId, timeoutMs: 5000 }, { emitResult: false, runtimeConfig: { rateLimitQps: 3, rateLimitBurst: 3, cooldownThreshold: 3, cooldownMs: 1000 } });
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
});
