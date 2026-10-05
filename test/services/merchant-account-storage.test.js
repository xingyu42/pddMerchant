import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { mockMerchantProbeTransport } from '../helpers/merchant-probe-transport.js';

const control = vi.hoisted(() => ({ mallId: 900001, failSave: false, failedSlug: null, onLoginPage: null }));
vi.mock('../../src/adapter/browser.js', () => ({
  launchBrowser: vi.fn(async ({ storageStatePath }) => {
    let current = storageStatePath ? (await loadAuthState(storageStatePath)).state : { cookies: [], origins: [] };
    const browser = {};
    const context = {
      browser: () => browser,
      storageState: async () => structuredClone(current),
      cookies: async () => structuredClone(current.cookies),
    };
    const page = {
      goto: async () => control.onLoginPage(() => { current = structuredClone(state); }),
      close: async () => {},
    };
    return { browser, context, page };
  }),
  closeBrowser: vi.fn(async () => {}),
  createSnapshotContext: async (_browser, state) => ({ cookies: async () => state.cookies, close: async () => {} }),
}));
vi.mock('../../src/infra/output.js', () => ({ emit: vi.fn((envelope) => envelope) }));
vi.mock('../../src/infra/account-registry.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, upsertAccount: async (...args) => {
    if (control.failSave) {
      control.failedSlug = args[0].slug;
      throw Object.assign(new Error('synthetic-secret'), { code: 'EACCES' });
    }
    return actual.upsertAccount(...args);
  } };
});
import { verifyMerchantContext, assertMerchantVerified } from '../../src/adapter/merchant-auth.js';
import { withMerchantAuthUpdate, commitMerchantCandidate } from '../../src/adapter/merchant-auth-storage.js';
import { withMerchantLoginRegistration, provisionMerchantAuth } from '../../src/services/auth-account-storage.js';
import { upsertAccount, findAccountByMallId, removeAccount } from '../../src/infra/account-registry.js';
import { ACCOUNTS_DIR, ACCOUNT_REGISTRY_PATH, accountAuthStatePath } from '../../src/infra/paths.js';
import { getAuthStateRevision, loadAuthState } from '../../src/adapter/auth-state.js';
import { runInteractiveLogin } from '../../src/commands/init.js';
import { launchBrowser } from '../../src/adapter/browser.js';

let root;
let sourcePath;
const state = { cookies: [{ name: 'PASS_ID', value: 'synthetic' }], origins: [] };
beforeEach(async () => {
  vi.stubEnv('PDD_TEST_ADAPTER', '');
  root = await mkdtemp(join(tmpdir(), 'pdd-auth-registration-'));
  sourcePath = join(root, 'pending.json');
  control.mallId = 900001;
  control.failSave = false;
  control.failedSlug = null;
  control.onLoginPage = (authorize) => authorize();
  launchBrowser.mockClear();
  mockMerchantProbeTransport(() => ({ mallId: control.mallId, mallName: 'Renamed Shop' }));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(ACCOUNTS_DIR, { recursive: true, force: true });
  await rm(ACCOUNT_REGISTRY_PATH, { force: true });
});

async function prepareCandidate() {
  const result = await verifyMerchantContext({ storageState: async () => state, browser: () => ({}) });
  assertMerchantVerified(result);
  await withMerchantAuthUpdate(sourcePath, async (transaction) => commitMerchantCandidate(result.candidate, transaction));
  return result;
}

describe('merchant registration commit', () => {
  it('keeps an existing slug stable when the display name changes', async () => {
    control.mallId = 900001;
    await upsertAccount({ slug: 'original-slug', displayName: 'Original Shop', mallId: '900001' });
    const target = accountAuthStatePath('original-slug');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(state));
    const registered = await withMerchantLoginRegistration(async (registration) => {
      const verified = await prepareCandidate();
      return provisionMerchantAuth(sourcePath, verified.identity, { candidate: verified.candidate, ...registration });
    });
    assert.equal(registered.account.slug, 'original-slug');
    assert.equal(registered.account.displayName, 'Renamed Shop');
    assert.equal(JSON.parse(await readFile(target, 'utf8')).merchant_auth.mall_id, '900001');
  });

  it('automatically publishes a first account only after verified material is written', async () => {
    control.mallId = 900002;
    const registered = await withMerchantLoginRegistration(async (registration) => {
      const verified = await prepareCandidate();
      return provisionMerchantAuth(sourcePath, verified.identity, { candidate: verified.candidate, ...registration });
    });
    assert.equal(registered.account.mallId, '900002');
    assert.equal((await findAccountByMallId('900002')).slug, registered.account.slug);
    assert.equal(JSON.parse(await readFile(registered.authPath, 'utf8')).merchant_auth.scope, 'shop_read');
  });

  it('refuses a target account changed since acquisition began', async () => {
    control.mallId = 900003;
    await upsertAccount({ slug: 'newer-slug', displayName: 'Original', mallId: '900003' });
    const target = accountAuthStatePath('newer-slug');
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, JSON.stringify(state));
    const oldRevision = await getAuthStateRevision(target);
    const verified = await prepareCandidate();
    const newer = JSON.stringify({ ...state, origins: [{ origin: 'https://mms.pinduoduo.com', localStorage: [] }] });
    await writeFile(target, newer);
    await assert.rejects(provisionMerchantAuth(sourcePath, verified.identity, { candidate: verified.candidate, initialRevisions: new Map([['newer-slug', oldRevision]]) }), { code: 'E_AUTH_STATE_CONFLICT' });
    assert.equal(await readFile(target, 'utf8'), newer);
  });

  it('removes unpublished new material and does not expose storage errors', async () => {
    control.mallId = 900004;
    await assert.rejects(withMerchantLoginRegistration(async (registration) => {
      const verified = await prepareCandidate(); control.failSave = true;
      return provisionMerchantAuth(sourcePath, verified.identity, { candidate: verified.candidate, ...registration });
    }), (error) => {
      assert.ok(!JSON.stringify(error).includes('synthetic-secret')); return true;
    });
    assert.equal(await findAccountByMallId('900004'), null);
    assert.ok(control.failedSlug, 'registration must reach the failing registry write');
    await assert.rejects(readFile(accountAuthStatePath(control.failedSlug)), { code: 'ENOENT' });
  });

  it('rejects a registration label that disagrees with the verified identity', async () => {
    control.mallId = 900005;
    const verified = await prepareCandidate();
    await assert.rejects(provisionMerchantAuth(sourcePath, { mallId: '900006', displayName: 'Wrong' }, { candidate: verified.candidate }), { code: 'E_ACCOUNT_IDENTITY_MISMATCH' });
    assert.equal(await findAccountByMallId('900006'), null);
  });

  it('serializes account removal with the entire login registration', async () => {
    control.mallId = 900007;
    await upsertAccount({ slug: 'removed-slug', displayName: 'Original', mallId: '900007' });
    let removal;
    let removed = false;
    await withMerchantLoginRegistration(async (registration) => {
      const verified = await prepareCandidate();
      removal = removeAccount('removed-slug').then(() => { removed = true; });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(removed, false);
      await provisionMerchantAuth(sourcePath, verified.identity, { candidate: verified.candidate, ...registration });
      assert.equal(removed, false);
    });
    await removal;
    assert.equal(removed, true);
    assert.equal(await findAccountByMallId('900007'), null);
  });

  it('replaces a corrupt registered target with separately verified material', async () => {
    await upsertAccount({ slug: 'recovery-shop', displayName: 'Shop', mallId: '900001' });
    const target = accountAuthStatePath('recovery-shop');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, 'not json');
    const registered = await withMerchantLoginRegistration(async (registration) => {
      const verified = await prepareCandidate();
      assert.equal(await readFile(target, 'utf8'), 'not json');
      return provisionMerchantAuth(sourcePath, verified.identity, { ...registration, candidate: verified.candidate });
    });
    assert.equal(registered.account.slug, 'recovery-shop');
    assert.equal((await loadAuthState(target)).state.merchant_auth.mall_id, '900001');
  });
});

describe('merchant login registration boundary', () => {
  it('keeps explicit-path login independent of a corrupt registry', async () => {
    await mkdir(dirname(ACCOUNT_REGISTRY_PATH), { recursive: true });
    await writeFile(ACCOUNT_REGISTRY_PATH, 'not json');
    const result = await runInteractiveLogin({ authStatePath: sourcePath, json: true, timeoutMs: 5000 });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(await readFile(ACCOUNT_REGISTRY_PATH, 'utf8'), 'not json');
    assert.equal((await loadAuthState(sourcePath)).state.merchant_auth.mall_id, '900001');
  });

  for (const raw of ['not json', JSON.stringify({ cookies: [] })]) {
    it(`waits for authorization before repairing ${raw === 'not json' ? 'invalid JSON' : 'missing storage fields'}`, async () => {
      await upsertAccount({ slug: 'recovery-shop', displayName: 'Shop', mallId: '900001' });
      const target = accountAuthStatePath('recovery-shop');
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, raw);
      let showLogin;
      const loginPage = new Promise((resolve) => { showLogin = resolve; });
      control.onLoginPage = (authorize) => { showLogin(authorize); };
      const controller = new AbortController();
      const pending = runInteractiveLogin({ account: 'recovery-shop', json: true, timeoutMs: 5000, signal: controller.signal });
      try {
        const authorize = await Promise.race([
          loginPage,
          pending.then((result) => { throw new Error(`Login ended before authorization: ${result.error?.code}`); }),
        ]);
        assert.equal(launchBrowser.mock.calls[0][0].storageStatePath, undefined);
        assert.equal(await readFile(target, 'utf8'), raw);
        authorize();
        const result = await pending;
        assert.equal(result.ok, true, JSON.stringify(result.error));
        assert.equal(result.data.account, 'recovery-shop');
        assert.equal((await loadAuthState(target)).state.merchant_auth.mall_id, '900001');
      } finally {
        controller.abort();
        await pending;
      }
    });
  }
});
