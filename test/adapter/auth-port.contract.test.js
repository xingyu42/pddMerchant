import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { createLiveAuthPort } from '../../src/adapter/auth-port.js';
import { createFixtureAuthPort } from '../../src/adapter/fixtures/auth.js';
import { createInMemoryAuthPort } from '../helpers/in-memory-ports.js';
import { createCandidateSeal } from '../../src/infra/candidate-seal.js';
import { createLiveBrowserRuntime } from '../../src/adapter/browser.js';
import { createFixtureBrowserRuntime } from '../../src/adapter/fixtures/browser.js';
import { createInMemoryBrowserRuntime } from '../helpers/in-memory-ports.js';
import { mockMerchantProbeTransport } from '../helpers/merchant-probe-transport.js';
import { insertAccount } from '../../src/infra/account-store.js';
import { loadAuthState, saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { recordMerchantCheck, withMerchantAuthUpdate } from '../../src/adapter/merchant-auth-storage.js';
import { createCliSandbox } from '../helpers/isolated-cli.js';

const validCookies = [{ name: 'PASS_ID', value: 'synthetic-pass', domain: '.pinduoduo.com', path: '/', secure: true }];
const validState = { cookies: validCookies, origins: [] };

function createMockChromiumForAuth(state = validState) {
  return {
    executablePath: () => '/synthetic/chromium',
    async launch() {
      return {
        version: async () => '136.0.0.0',
        contexts: () => [],
        close: async () => {},
        newContext: async (opts) => {
          const snapshot = structuredClone(opts.storageState ?? state);
          return {
            addInitScript: async () => {},
            newPage: async () => ({
              goto: async () => {},
              url: () => 'https://mobile.yangkeduo.com/home',
              close: async () => {},
            }),
            storageState: async () => structuredClone(snapshot),
            cookies: async () => structuredClone(snapshot.cookies),
            close: async () => {},
          };
        },
      };
    },
  };
}

const sandboxes = [];
let probeState;

beforeEach(() => {
  probeState = { mallId: 900001, mallName: 'Shop A', login: true, malformed: false };
  mockMerchantProbeTransport(() => probeState);
});

afterEach(() => {
  while (sandboxes.length > 0) {
    sandboxes.pop().dispose();
  }
});

const ADAPTER_FACTORIES = [
  {
    name: 'live',
    expectedAuthoritative: true,
    create: ({
      seal,
      mallId = 900001,
      mallName = 'Shop A',
      login = true,
      malformed = false,
      consumerOnline = true,
      storageState = validState,
    } = {}) => {
      probeState.mallId = mallId;
      probeState.mallName = mallName;
      probeState.login = login;
      probeState.malformed = malformed;
      const browserRuntime = createLiveBrowserRuntime({
        loadChromium: async () => createMockChromiumForAuth(storageState),
      });
      const authPort = createLiveAuthPort({ seal });
      const consumerPage = {
        goto: vi.fn(async () => {}),
        url: () => (consumerOnline ? 'https://mobile.yangkeduo.com/home' : 'https://mobile.yangkeduo.com/login.html'),
      };
      return { authPort, browserRuntime, storageState, consumerPage };
    },
  },
  {
    name: 'fixture',
    expectedAuthoritative: false,
    create: ({
      seal,
      mallId = 900001,
      mallName = 'Shop A',
      login = true,
      malformed = false,
      consumerOnline = true,
      storageState = validState,
    } = {}) => {
      const sandbox = createCliSandbox({
        'shops.current.json': { id: String(mallId), name: mallName },
      });
      sandboxes.push(sandbox);
      const browserRuntime = createFixtureBrowserRuntime();
      const authPort = createFixtureAuthPort({
        seal,
        authInvalid: !login,
        authIndeterminate: malformed,
        consumerAuthInvalid: !consumerOnline,
        getCurrentMall: async () => ({ id: String(mallId), name: mallName }),
      });
      const consumerPage = {
        goto: vi.fn(() => { throw new Error('fixture must not navigate'); }),
        url: () => 'https://mobile.yangkeduo.com/login.html',
      };
      return { authPort, browserRuntime, storageState, consumerPage };
    },
  },
  {
    name: 'in-memory',
    expectedAuthoritative: true,
    create: ({
      seal,
      authoritative = true,
      mallId = 900001,
      mallName = 'Shop A',
      login = true,
      malformed = false,
      consumerOnline = true,
      storageState = validState,
    } = {}) => {
      const browserRuntime = createInMemoryBrowserRuntime();
      const authPort = createInMemoryAuthPort({
        seal,
        authoritative,
        merchantVerdict: malformed ? 'indeterminate' : (login ? 'verified' : 'rejected'),
        merchantIdentity: { mallId: String(mallId), displayName: mallName },
        consumerOnline,
      });
      const consumerPage = {
        goto: vi.fn(async () => {}),
        url: () => (consumerOnline ? 'https://mobile.yangkeduo.com/home' : 'https://mobile.yangkeduo.com/login.html'),
      };
      return { authPort, browserRuntime, storageState, consumerPage };
    },
  },
];

describe.each(ADAPTER_FACTORIES)('AuthPort 3-method shared contract ($name)', ({ name, expectedAuthoritative, create }) => {
  it('exposes only the frozen 3-method AuthPort surface and validates CandidateSeal on creation', () => {
    const { authPort } = create({ seal: createCandidateSeal() });
    assert.deepEqual(Object.keys(authPort).sort(), ['checkConsumerOnline', 'checkMerchant', 'verifyAndSeal']);
    const factory = name === 'live'
      ? createLiveAuthPort
      : (name === 'fixture' ? createFixtureAuthPort : createInMemoryAuthPort);
    assert.throws(() => factory({ seal: null }), { code: 'E_CONFIG_INVALID' });
    assert.throws(() => factory({ seal: {} }), { code: 'E_CONFIG_INVALID' });
  });

  it('checkMerchant returns uniform verified, rejected, indeterminate and known_rejected shapes with authoritative flag', async () => {
    const verified = create({ login: true });
    const vRes = await verified.authPort.checkMerchant(validState);
    assert.equal(vRes.verdict, 'verified');
    assert.equal(vRes.reason, 'login_true');
    assert.equal(vRes.http_status, 200);
    assert.equal(vRes.authoritative, expectedAuthoritative);
    assert.ok(Number.isFinite(Date.parse(vRes.checked_at)));

    const rejected = create({ login: false });
    const rRes = await rejected.authPort.checkMerchant(validState);
    assert.equal(rRes.verdict, 'rejected');
    assert.equal(rRes.reason, 'login_false');
    assert.equal(rRes.authoritative, expectedAuthoritative);

    const indeterminate = create({ malformed: true });
    const iRes = await indeterminate.authPort.checkMerchant(validState);
    assert.equal(iRes.verdict, 'indeterminate');
    assert.equal(iRes.authoritative, expectedAuthoritative);

    const known = await verified.authPort.checkMerchant({
      ...validState,
      merchant_auth: { version: 1, mall_id: '900001', last_check: { verdict: 'rejected', reason: 'login_false', checked_at: new Date().toISOString() } },
    });
    assert.equal(known.verdict, 'rejected');
    assert.equal(known.reason, 'known_rejected');
    assert.equal(known.authoritative, expectedAuthoritative);

    const controller = new AbortController();
    controller.abort();
    const cancelled = await verified.authPort.checkMerchant(validState, { signal: controller.signal });
    assert.equal(cancelled.verdict, 'indeterminate');
    assert.equal(cancelled.reason, 'cancelled');
    assert.equal(cancelled.authoritative, expectedAuthoritative);
  });

  it('verifyAndSeal seals candidates with the instance CandidateSeal and isolates foreign seals', async () => {
    const sealA = createCandidateSeal();
    const sealB = createCandidateSeal();
    const { authPort, browserRuntime, storageState } = create({ seal: sealA });

    const verified = await browserRuntime.withSession({ storageState }, (session) =>
      authPort.verifyAndSeal(session, { expectedMallId: '900001' }));
    assert.equal(verified.verdict, 'verified');
    assert.equal(verified.reason, 'shop_read');
    assert.equal(verified.authoritative, expectedAuthoritative);
    assert.deepEqual(verified.identity, { mallId: '900001', displayName: 'Shop A' });
    assert.equal(sealA.has(verified.candidate), true);
    assert.equal(sealB.has(verified.candidate), false);
    assert.throws(() => sealB.assert(verified.candidate), { code: 'E_AUTH_CANDIDATE_INVALID' });

    const mismatch = await browserRuntime.withSession({ storageState }, (session) =>
      authPort.verifyAndSeal(session, { expectedMallId: '900002' }));
    assert.equal(mismatch.verdict, 'failed');
    assert.equal(mismatch.reason, 'identity_mismatch');
    assert.equal(mismatch.authoritative, expectedAuthoritative);
    assert.equal(Object.hasOwn(mismatch, 'candidate'), false);

    const corrupt = create({ seal: sealA });
    await corrupt.browserRuntime.withSession({ storageState }, async (session) => {
      await assert.rejects(
        corrupt.authPort.verifyAndSeal(session, { state: { ...validState, merchant_auth: { version: 2, mall_id: '900001' } } }),
        { code: 'E_AUTH_STATE_CORRUPT' },
      );
    });
  });

  it('checkConsumerOnline returns { ok, authoritative, detail: { url } }', async () => {
    const online = create({ consumerOnline: true });
    const onlineRes = await online.authPort.checkConsumerOnline(online.consumerPage);
    assert.equal(onlineRes.ok, true);
    assert.equal(onlineRes.authoritative, expectedAuthoritative);
    assert.equal(typeof onlineRes.detail, 'object');

    const offline = create({ consumerOnline: false });
    const offlineRes = await offline.authPort.checkConsumerOnline(offline.consumerPage);
    assert.equal(offlineRes.ok, false);
    assert.equal(offlineRes.authoritative, expectedAuthoritative);
  });

  it('uses authoritative flag to gate local SQLite verification record persistence', async () => {
    const account = insertAccount({ identity: '900001', displayName: 'Shop A' });
    saveAuthStateSnapshot(validState, account.id);

    const { authPort, browserRuntime, storageState } = create({ login: false });
    const checkResult = await browserRuntime.withSession({ storageState }, (session) =>
      authPort.verifyAndSeal(session, { expectedMallId: '900001' }));
    assert.equal(checkResult.verdict, 'rejected');
    assert.equal(checkResult.authoritative, expectedAuthoritative);

    await withMerchantAuthUpdate(account.id, (tx) => {
      recordMerchantCheck(checkResult, tx);
    });

    const loaded = loadAuthState(account.id);
    if (expectedAuthoritative) {
      assert.equal(loaded.revision, 2);
      assert.equal(loaded.metadata?.last_check?.verdict, 'rejected');
    } else {
      assert.equal(loaded.revision, 1);
      assert.equal(loaded.metadata, null);
    }
  });
});

describe('AuthPort mode-specific safeguards', () => {
  it('Live checkMerchant rejects states without PASS_ID using E_AUTH_CANDIDATE_INVALID', async () => {
    const authPort = createLiveAuthPort();
    await assert.rejects(
      authPort.checkMerchant({ cookies: [], origins: [] }),
      { code: 'E_AUTH_CANDIDATE_INVALID' },
    );
  });

  it('InMemory authoritative=false skips SQLite check recording just like Fixture', async () => {
    const account = insertAccount({ identity: '900001', displayName: 'Shop A' });
    saveAuthStateSnapshot(validState, account.id);
    const authPort = createInMemoryAuthPort({ authoritative: false, merchantVerdict: 'indeterminate' });
    const result = await authPort.checkMerchant(validState);
    assert.equal(result.authoritative, false);

    await withMerchantAuthUpdate(account.id, (tx) => {
      recordMerchantCheck(result, tx);
    });
    assert.equal(loadAuthState(account.id).revision, 1);
    assert.equal(loadAuthState(account.id).metadata, null);
  });
});
