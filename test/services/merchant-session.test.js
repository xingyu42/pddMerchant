import assert from 'node:assert/strict';
import { it, vi } from 'vitest';
import * as autoRelogin from '../../src/services/auto-relogin.js';
import { withMerchantAuthUpdate } from '../../src/adapter/merchant-auth-storage.js';
import { insertAccount } from '../../src/infra/account-store.js';
import { createCandidateSeal } from '../../src/infra/candidate-seal.js';
import { loadAuthState, saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { checkMerchantSession } from '../../src/services/merchant-session.js';
import { createInMemoryAuthPort, createInMemoryBrowserRuntime } from '../helpers/in-memory-ports.js';

const checkedAt = '2026-11-07T00:00:00.000Z';

function setup(verdict, { authoritative = true } = {}) {
  const account = insertAccount({ identity: '900001', displayName: 'Shop' });
  saveAuthStateSnapshot({ cookies: [], origins: [] }, account.id);
  const seal = createCandidateSeal();
  const clock = { now: () => Date.parse(checkedAt), sleep: async () => {} };
  const authPort = createInMemoryAuthPort({
    seal,
    authoritative,
    merchantVerdict: verdict,
    merchantIdentity: { mallId: '900001', displayName: 'Shop' },
    now: clock.now,
  });
  return { account, seal, authPort, clock };
}

it('login mode records authoritative rejection and returns control for human authorization', async () => {
  const { account, seal, authPort } = setup('rejected', { authoritative: true });
  const recover = vi.spyOn(autoRelogin, 'recover');
  await withMerchantAuthUpdate(account.id, async (tx) => {
    const session = await checkMerchantSession(null, {
      tx,
      mode: 'login',
      task: { verifyContext: authPort.verifyAndSeal, seal },
    });
    assert.equal(session.result.verdict, 'rejected');
    assert.equal(session.result.reason, 'login_false');
    assert.equal(session.replacement, undefined);
    assert.equal(tx.revision, 2);
  }, { seal });
  assert.deepEqual(loadAuthState(account.id).metadata.last_check, {
    verdict: 'rejected',
    reason: 'login_false',
    checked_at: checkedAt,
  });
  assert.equal(recover.mock.calls.length, 0);
});

it.each(['command', 'login', 'patrol'])('%s mode records authoritative indeterminate checks and leaves recovery untouched', async (mode) => {
  const { account, seal, authPort } = setup('indeterminate', { authoritative: true });
  const recover = vi.spyOn(autoRelogin, 'recover');
  await withMerchantAuthUpdate(account.id, async (tx) => {
    await assert.rejects(
      checkMerchantSession(null, {
        tx,
        mode,
        task: { verifyContext: authPort.verifyAndSeal, seal },
      }),
      { code: 'E_AUTH_CHECK_INDETERMINATE' },
    );
  }, { seal });
  assert.equal(loadAuthState(account.id).revision, 2);
  assert.deepEqual(loadAuthState(account.id).metadata.last_check, {
    verdict: 'indeterminate',
    reason: 'network_error',
    checked_at: checkedAt,
  });
  assert.equal(recover.mock.calls.length, 0);
});

it('skips SQLite verification record persistence when AuthPort authoritative is false', async () => {
  const { account, seal, authPort } = setup('rejected', { authoritative: false });
  const recover = vi.spyOn(autoRelogin, 'recover');
  await withMerchantAuthUpdate(account.id, async (tx) => {
    const session = await checkMerchantSession(null, {
      tx,
      mode: 'login',
      task: { verifyContext: authPort.verifyAndSeal, seal },
    });
    assert.equal(session.result.verdict, 'rejected');
    assert.equal(session.result.authoritative, false);
    assert.equal(tx.revision, 1);
  }, { seal });
  assert.equal(loadAuthState(account.id).revision, 1);
  assert.equal(loadAuthState(account.id).metadata, null);
  assert.equal(recover.mock.calls.length, 0);
});

it('command mode records rejection before recovery and passes retainContext: true', async () => {
  const { account, seal, authPort } = setup('rejected', { authoritative: true });
  const browserRuntime = createInMemoryBrowserRuntime();
  const replacement = { context: {}, page: {} };
  const runtime = {
    signal: new AbortController().signal,
    seal,
    ports: { auth: authPort, browser: browserRuntime },
  };
  const sessionHandle = await browserRuntime.openSession({ storageState: { cookies: [], origins: [] } });
  const recoverSpy = vi.spyOn(autoRelogin, 'recover').mockImplementation(async (params) => {
    assert.equal(params.runtime, runtime);
    assert.equal(params.session, sessionHandle);
    assert.equal(params.retainContext, true);
    assert.equal(params.authResult.verdict, 'rejected');
    assert.equal(params.tx.revision, 2);
    assert.equal(loadAuthState(account.id).metadata.last_check.verdict, 'rejected');
    return replacement;
  });
  try {
    await withMerchantAuthUpdate(account.id, async (tx) => {
      const session = await checkMerchantSession(sessionHandle.context, {
        tx,
        runtime,
        session: sessionHandle,
      });
      assert.equal(session.replacement, replacement);
    }, { seal });
    assert.equal(recoverSpy.mock.calls.length, 1);
  } finally {
    await sessionHandle.close();
  }
});

it('patrol mode passes retainContext: false to auto-relogin', async () => {
  const { account, seal, authPort } = setup('rejected', { authoritative: true });
  const browserRuntime = createInMemoryBrowserRuntime();
  const runtime = {
    signal: new AbortController().signal,
    seal,
    ports: { auth: authPort, browser: browserRuntime },
  };
  const sessionHandle = await browserRuntime.openSession({ storageState: { cookies: [], origins: [] } });
  const recoverSpy = vi.spyOn(autoRelogin, 'recover').mockImplementation(async (params) => {
    assert.equal(params.retainContext, false);
    return undefined;
  });
  try {
    await withMerchantAuthUpdate(account.id, async (tx) => {
      const session = await checkMerchantSession(sessionHandle.context, {
        tx,
        runtime,
        session: sessionHandle,
        mode: 'patrol',
      });
      assert.equal(session.replacement, undefined);
    }, { seal });
    assert.equal(recoverSpy.mock.calls.length, 1);
  } finally {
    await sessionHandle.close();
  }
});
