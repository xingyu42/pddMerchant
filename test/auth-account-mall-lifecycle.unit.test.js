import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function loadAccountModules() {
  const registry = await import('../src/infra/account-registry.js');
  const resolver = await import('../src/infra/account-resolver.js');
  const paths = await import('../src/infra/paths.js');
  return { ...registry, ...resolver, ...paths };
}

function makeSpec(overrides = {}) {
  return {
    name: 'auth.account.mall.lifecycle',
    needsAuth: true,
    needsMall: 'none',
    async run() { return { value: 1 }; },
    ...overrides,
  };
}

describe('auth/account/mall lifecycle invariants', () => {
  let tmpDir;
  let savedRegistryPath;
  let savedAccountsDir;
  let savedAdapter;
  let savedAuthInvalid;

  beforeEach(async () => {
    savedRegistryPath = process.env.PDD_ACCOUNT_REGISTRY_PATH;
    savedAccountsDir = process.env.PDD_ACCOUNTS_DIR;
    savedAdapter = process.env.PDD_TEST_ADAPTER;
    savedAuthInvalid = process.env.PDD_TEST_AUTH_INVALID;

    tmpDir = await mkdtemp(join(tmpdir(), 'pdd-auth-account-mall-'));
    process.env.PDD_ACCOUNT_REGISTRY_PATH = join(tmpDir, 'accounts.json');
    process.env.PDD_ACCOUNTS_DIR = join(tmpDir, 'accounts');
    process.env.PDD_TEST_ADAPTER = 'fixture';
    delete process.env.PDD_TEST_AUTH_INVALID;
    vi.resetModules();
  });

  afterEach(async () => {
    if (savedRegistryPath !== undefined) process.env.PDD_ACCOUNT_REGISTRY_PATH = savedRegistryPath;
    else delete process.env.PDD_ACCOUNT_REGISTRY_PATH;
    if (savedAccountsDir !== undefined) process.env.PDD_ACCOUNTS_DIR = savedAccountsDir;
    else delete process.env.PDD_ACCOUNTS_DIR;
    if (savedAdapter !== undefined) process.env.PDD_TEST_ADAPTER = savedAdapter;
    else delete process.env.PDD_TEST_ADAPTER;
    if (savedAuthInvalid !== undefined) process.env.PDD_TEST_AUTH_INVALID = savedAuthInvalid;
    else delete process.env.PDD_TEST_AUTH_INVALID;

    await rm(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('resolves an explicit auth path without account metadata', async () => {
    const { resolveAccountContext, accountMetaForEnvelope } = await loadAccountModules();

    const ctx = await resolveAccountContext({ authStatePath: join(tmpDir, 'manual-auth.json') });

    assert.equal(ctx.source, 'explicit-path');
    assert.equal(ctx.slug, null);
    assert.equal(ctx.account, null);
    assert.equal(ctx.authPath, join(tmpDir, 'manual-auth.json'));
    assert.deepEqual(accountMetaForEnvelope(ctx), {});
  });

  it('resolves default account to per-account auth path and envelope metadata', async () => {
    const { upsertAccount, resolveAccountContext, accountMetaForEnvelope, accountAuthStatePath } = await loadAccountModules();
    await upsertAccount({ slug: 'shop-a', displayName: '店铺A', mallId: '445301049' }, { setDefault: true });

    const ctx = await resolveAccountContext({});

    assert.equal(ctx.source, 'default');
    assert.equal(ctx.slug, 'shop-a');
    assert.equal(ctx.displayName, '店铺A');
    assert.equal(ctx.authPath, accountAuthStatePath('shop-a'));
    assert.equal(ctx.account.mallId, '445301049');
    assert.deepEqual(accountMetaForEnvelope(ctx), {
      account: 'shop-a',
      account_display_name: '店铺A',
      account_source: 'default',
    });
  });

  it('auto-selects a single enabled account when no default is set', async () => {
    const { upsertAccount, resolveAccountContext, accountAuthStatePath } = await loadAccountModules();
    await upsertAccount({ slug: 'solo-shop', displayName: '单店铺', mallId: '1001' });

    const ctx = await resolveAccountContext({});

    assert.equal(ctx.source, 'auto-single');
    assert.equal(ctx.slug, 'solo-shop');
    assert.equal(ctx.authPath, accountAuthStatePath('solo-shop'));
  });

  it('requires an explicit account when multiple enabled accounts exist without default', async () => {
    const { upsertAccount, resolveAccountContext } = await loadAccountModules();
    await upsertAccount({ slug: 'shop-a', displayName: '店铺A', mallId: '1001' });
    await upsertAccount({ slug: 'shop-b', displayName: '店铺B', mallId: '1002' });

    await assert.rejects(
      () => resolveAccountContext({}),
      (err) => err.code === 'E_ACCOUNT_REQUIRED' && err.exitCode === 2,
    );
  });

  it('uses the unregistered business default path without account metadata when registry is missing', async () => {
    const { resolveAccountContext, accountMetaForEnvelope, AUTH_STATE_PATH } = await loadAccountModules();

    const ctx = await resolveAccountContext({});

    assert.equal(ctx.source, 'unregistered-default');
    assert.equal(ctx.slug, null);
    assert.equal(ctx.account, null);
    assert.equal(ctx.authPath, AUTH_STATE_PATH);
    assert.deepEqual(accountMetaForEnvelope(ctx), {});
  });

  it('injects explicit account context into fixture command ctx and success envelope meta', async () => {
    const { upsertAccount, accountAuthStatePath } = await loadAccountModules();
    await upsertAccount({ slug: 'shop-a', displayName: '店铺A', mallId: '445301049' });
    const { executeSingle } = await import('../src/commands/_runner.js');

    let captured;
    const envelope = await executeSingle(
      makeSpec({
        async run(ctx) {
          captured = ctx;
          return { data: { ok: true } };
        },
      }),
      { json: true, noColor: true, account: 'shop-a' },
      { emitResult: false, skipDaemonStart: true },
    );

    assert.equal(envelope.ok, true);
    assert.equal(captured.accountSlug, 'shop-a');
    assert.equal(captured.account.slug, 'shop-a');
    assert.equal(captured.authPath, accountAuthStatePath('shop-a'));
    assert.equal(envelope.meta.account, 'shop-a');
    assert.equal(envelope.meta.account_display_name, '店铺A');
    assert.equal(envelope.meta.account_source, 'flag');
  });

  it('injects default account context into fixture command ctx and success envelope meta', async () => {
    const { upsertAccount, accountAuthStatePath } = await loadAccountModules();
    await upsertAccount({ slug: 'shop-default', displayName: '默认店铺', mallId: '445301049' }, { setDefault: true });
    const { executeSingle } = await import('../src/commands/_runner.js');

    let captured;
    const envelope = await executeSingle(
      makeSpec({
        async run(ctx) {
          captured = ctx;
          return { data: { ok: true } };
        },
      }),
      { json: true, noColor: true },
      { emitResult: false, skipDaemonStart: true },
    );

    assert.equal(envelope.ok, true);
    assert.equal(captured.accountSlug, 'shop-default');
    assert.equal(captured.account.slug, 'shop-default');
    assert.equal(captured.authPath, accountAuthStatePath('shop-default'));
    assert.equal(envelope.meta.account, 'shop-default');
    assert.equal(envelope.meta.account_display_name, '默认店铺');
    assert.equal(envelope.meta.account_source, 'default');
  });
});
