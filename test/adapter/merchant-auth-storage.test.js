import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { mockMerchantProbeTransport } from '../helpers/merchant-probe-transport.js';

vi.mock('../../src/adapter/browser.js', () => ({
  createSnapshotContext: vi.fn(async (_browser, state) => ({
    cookies: async () => structuredClone(state.cookies), close: vi.fn(async () => {}),
  })),
}));
import { verifyMerchantContext, assertMerchantVerified } from '../../src/adapter/merchant-auth.js';
import { withMerchantAuthUpdate, commitMerchantCandidate, recordMerchantCheck, boundMerchantMallId, assertAuthTask } from '../../src/adapter/merchant-auth-storage.js';
import { saveAuthStateSnapshot, loadAuthState } from '../../src/adapter/auth-state.js';
import { isLockStale } from '../../src/infra/auth-lock.js';
import { redactRecursive } from '../../src/infra/logger.js';
import { PddCliError, ExitCodes } from '../../src/infra/errors.js';

const state = { cookies: [{ name: 'PASS_ID', value: 'synthetic', domain: '.pinduoduo.com', path: '/', secure: true }], origins: [] };
let root;
let path;

function mockVerifiedTransport({ mallId = 900001, login = true } = {}) {
  return mockMerchantProbeTransport({ mallId, login });
}

async function candidate(options) {
  const context = { storageState: async () => structuredClone(state), browser: () => ({}) };
  const result = await verifyMerchantContext(context, options);
  assertMerchantVerified(result);
  return result.candidate;
}

beforeEach(async () => {
  vi.stubEnv('PDD_TEST_ADAPTER', '');
  root = await mkdtemp(join(tmpdir(), 'pdd-merchant-update-'));
  path = join(root, 'auth-state.json');
  mockVerifiedTransport();
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('verified frozen merchant material', () => {
  it('rejects a different stable shop before returning a candidate', async () => {
    const context = { storageState: async () => state, browser: () => ({}) };
    const result = await verifyMerchantContext(context, { expectedMallId: '900002' });
    assert.equal(result.reason, 'identity_mismatch');
    assert.ok(!Object.hasOwn(result, 'candidate'));
    assert.throws(() => assertMerchantVerified(result), { code: 'E_ACCOUNT_IDENTITY_MISMATCH' });
  });

  it('freezes a detached state and does not persist token or derived header duplicates', async () => {
    const verified = await candidate();
    assert.ok(Object.isFrozen(verified.state.cookies[0]));
    await withMerchantAuthUpdate(path, async (transaction) => commitMerchantCandidate(verified, transaction));
    const saved = JSON.parse(await readFile(path, 'utf8'));
    assert.deepEqual(saved.cookies, state.cookies);
    assert.equal(saved.merchant_auth.mall_id, '900001');
    assert.equal(saved.merchant_auth.scope, 'shop_read');
    assert.equal(saved.merchant_auth.check_verdict, 'verified');
    assert.ok(!Object.hasOwn(saved, 'login_token'));
    assert.ok(!Object.hasOwn(saved, 'cookie_headers'));
  });

  it('rejects arbitrary objects that pretend to be verified', async () => {
    await assert.rejects(withMerchantAuthUpdate(path, async (transaction) => {
      await commitMerchantCandidate({ state, identity: { mallId: '900001' }, scope: 'shop_read' }, transaction);
    }), { code: 'E_AUTH_CANDIDATE_INVALID' });
    assert.deepEqual(await readdir(root), []);
  });

  it('keeps legacy cookies/origins loadable and binds them after verification', async () => {
    await writeFile(path, JSON.stringify(state));
    assert.equal(boundMerchantMallId((await loadAuthState(path)).state), null);
    await withMerchantAuthUpdate(path, async (transaction) => commitMerchantCandidate(await candidate(), transaction));
    assert.equal(boundMerchantMallId((await loadAuthState(path)).state), '900001');
  });

  it('preserves a custom file already bound to another shop', async () => {
    for (const storage of [state, {}]) {
      const original = JSON.stringify({ ...storage, merchant_auth: { version: 1, mall_id: '900002' } });
      await writeFile(path, original);
      await assert.rejects(withMerchantAuthUpdate(path, async (transaction) => commitMerchantCandidate(await candidate(), transaction),
        { recoveryMallId: '900001' }), { code: 'E_ACCOUNT_IDENTITY_MISMATCH' });
      assert.equal(await readFile(path, 'utf8'), original);
    }
  });

  it('rejects corrupt storage unless recovery has a trusted registered identity', async () => {
    for (const raw of ['not json', JSON.stringify({ cookies: [] })]) {
      await writeFile(path, raw);
      const run = vi.fn();
      await assert.rejects(withMerchantAuthUpdate(path, run), { code: 'E_AUTH_STATE_CORRUPT' });
      assert.equal(run.mock.calls.length, 0);
      assert.equal(await readFile(path, 'utf8'), raw);
    }
  });

  it('rejects malformed bindings instead of treating them as a first login', () => {
    for (const metadata of [{ version: 2, mall_id: '900001' }, { version: 1, mall_id: {} }]) {
      assert.throws(() => boundMerchantMallId({ merchant_auth: metadata }), { code: 'E_AUTH_STATE_CORRUPT' });
    }
  });

  it('does not overwrite an externally changed file', async () => {
    const newer = JSON.stringify({ ...state, cookies: [{ ...state.cookies[0], value: 'newer-synthetic' }] });
    for (const original of [JSON.stringify(state), 'not json']) {
      await writeFile(path, original);
      await assert.rejects(withMerchantAuthUpdate(path, async (transaction) => {
        const verified = await candidate();
        await writeFile(path, newer);
        await commitMerchantCandidate(verified, transaction);
      }, { recoveryMallId: '900001' }), { code: 'E_AUTH_STATE_CONFLICT' });
      assert.equal(await readFile(path, 'utf8'), newer);
      assert.ok(!(await readdir(root)).some((name) => name.endsWith('.tmp') || name.endsWith('.lock')));
    }
  });

  it('checks cancellation again immediately before commit', async () => {
    const controller = new AbortController();
    await assert.rejects(withMerchantAuthUpdate(path, async (transaction) => {
      const verified = await candidate();
      controller.abort();
      await commitMerchantCandidate(verified, transaction);
    }, { signal: controller.signal }), { code: 'E_AUTH_CANCELLED' });
    assert.deepEqual(await readdir(root), []);
    await writeFile(path, 'not json');
    const recoveryController = new AbortController();
    await assert.rejects(withMerchantAuthUpdate(path, async (transaction) => {
      const verified = await candidate();
      recoveryController.abort();
      await commitMerchantCandidate(verified, transaction);
    }, { signal: recoveryController.signal, recoveryMallId: '900001' }), { code: 'E_AUTH_CANCELLED' });
    assert.equal(await readFile(path, 'utf8'), 'not json');
    assert.deepEqual(await readdir(root), ['auth-state.json']);
  });

  it('checks task expiry again immediately before commit', async () => {
    await assert.rejects(withMerchantAuthUpdate(path, async (transaction) => {
      const verified = await candidate();
      transaction.deadlineAt = Date.now() - 1;
      await commitMerchantCandidate(verified, transaction);
    }), { code: 'E_AUTH_TIMEOUT' });
    assert.deepEqual(await readdir(root), []);
  });

  it('preserves an explicit deadline abort even at a timer clock boundary', () => {
    const controller = new AbortController();
    controller.abort(new PddCliError({ code: 'E_AUTH_TIMEOUT', message: 'synthetic expiry', exitCode: ExitCodes.NETWORK }));
    assert.throws(() => assertAuthTask({ signal: controller.signal, deadlineAt: Date.now() + 1 }), { code: 'E_AUTH_TIMEOUT' });
  });

  it('serializes two updates to the same account', async () => {
    const order = [];
    let releaseFirst;
    let firstStarted;
    const started = new Promise((resolve) => { firstStarted = resolve; });
    const hold = new Promise((resolve) => { releaseFirst = resolve; });
    const first = withMerchantAuthUpdate(path, async (transaction) => {
      order.push('first'); firstStarted(); await hold;
      await commitMerchantCandidate(await candidate(), transaction);
    });
    await started;
    const second = withMerchantAuthUpdate(path, async (transaction) => {
      order.push('second');
      assert.equal(transaction.state.merchant_auth.mall_id, '900001');
      await commitMerchantCandidate(await candidate(), transaction);
    });
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(order, ['first', 'second']);
    assert.deepEqual(await readdir(root), ['auth-state.json']);
  });

  it('preserves cookies when recording rejection or network uncertainty', async () => {
    for (const verdict of ['rejected', 'indeterminate']) {
      await writeFile(path, JSON.stringify(state));
      await withMerchantAuthUpdate(path, async (transaction) => recordMerchantCheck({ verdict, reason: 'synthetic', checked_at: new Date().toISOString() }, transaction));
      const saved = (await loadAuthState(path)).state;
      assert.deepEqual(saved.cookies, state.cookies);
      assert.equal(saved.merchant_auth.last_check.verdict, verdict);
      assert.equal(saved.merchant_auth.usable, false);
    }
  });

  it('cleans a protected temporary file if pre-commit validation fails', async () => {
    await assert.rejects(saveAuthStateSnapshot(state, path, { beforeCommit: async () => { throw new Error('synthetic failure'); } }), { code: 'E_AUTH_STATE_SAVE_FAILED' });
    assert.deepEqual(await readdir(root), []);
  });

  it('does not reclaim a live owner solely because a long task is old', () => {
    assert.equal(isLockStale({ pid: process.pid, hostname: hostname(), createdAt: Date.now() - 3600000 }), false);
  });

  it('distinguishes deadline expiry from a manual cancellation', () => {
    const controller = new AbortController(); controller.abort();
    assert.throws(() => assertAuthTask({ signal: controller.signal }), { code: 'E_AUTH_CANCELLED' });
    assert.throws(() => assertAuthTask({ signal: controller.signal, deadlineAt: Date.now() - 1 }), { code: 'E_AUTH_TIMEOUT' });
  });

  it('redacts all added credential aliases', () => {
    const keys = ['LoginToken', 'login_token', 'loginToken', 'PASS_ID', 'pass_id_value', 'ck', 'cookie_headers', 'cookieHeaders'];
    const redacted = redactRecursive(Object.fromEntries(keys.map((key) => [key, 'synthetic-secret'])));
    assert.ok(keys.every((key) => redacted[key].startsWith('fp:')));
    assert.ok(!JSON.stringify(redacted).includes('synthetic-secret'));
  });
});
