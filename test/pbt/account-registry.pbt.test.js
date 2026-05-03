import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { property, gen } from './_harness.js';
import {
  slugifyAccountName,
  loadAccountRegistry,
  saveAccountRegistry,
  upsertAccount,
  removeAccount,
  listAccounts,
  getAccount,
  setDefaultAccount,
  migrateLegacyToDefaultAccount,
} from '../../src/infra/account-registry.js';

const SLUG_RE = /^[a-z0-9一-鿿_-]{1,32}$/;

describe('slugifyAccountName PBT', () => {
  it('determinism: same input → same slug', async () => {
    await property(
      'slug-determinism',
      gen.string({ minLen: 1, maxLen: 30 }),
      (name) => {
        const a = slugifyAccountName(name);
        const b = slugifyAccountName(name);
        assert.equal(a, b);
      },
    );
  });

  it('filesystem safety: slug matches safe pattern', async () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789 !@#$%^&*()张三的旗舰店\t\n';
    await property(
      'slug-filesystem-safety',
      gen.string({ minLen: 1, maxLen: 30, chars }),
      (name) => {
        const slug = slugifyAccountName(name);
        assert.ok(slug.length > 0, `empty slug for "${name}"`);
        assert.ok(slug.length <= 32, `slug too long: "${slug}"`);
        assert.match(slug, SLUG_RE, `slug "${slug}" does not match safe pattern`);
      },
    );
  });

  it('collision resolution appends hash suffix', () => {
    const existing = new Set(['test-shop']);
    const slug = slugifyAccountName('test-shop', { existingSlugs: existing });
    assert.match(slug, /^test-shop-[a-f0-9]{6}$/);
  });

  it('Windows reserved names are escaped', () => {
    for (const name of ['CON', 'NUL', 'PRN', 'AUX', 'com1', 'lpt1']) {
      const slug = slugifyAccountName(name);
      assert.ok(slug.startsWith('_'), `"${name}" should be prefixed with _`);
    }
  });

  it('Chinese shop names slugify correctly', () => {
    const slug = slugifyAccountName('张三的旗舰店');
    assert.match(slug, SLUG_RE);
    assert.equal(slug, '张三的旗舰店');
  });
});

describe('account-registry CRUD', () => {
  let tmpDir;
  let regPath;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'pdd-reg-'));
    regPath = join(tmpDir, 'accounts.json');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('fresh registry creation', async () => {
    const reg = await loadAccountRegistry({ path: regPath, createIfMissing: true });
    assert.equal(reg.version, 1);
    assert.equal(reg.defaultAccount, null);
    assert.deepStrictEqual(reg.accounts, {});
  });

  it('corrupt registry rejects', async () => {
    await writeFile(regPath, 'not json!', 'utf8');
    await assert.rejects(
      () => loadAccountRegistry({ path: regPath }),
      (err) => err.code === 'E_ACCOUNT_REGISTRY_CORRUPT',
    );
  });

  it('upsert creates then updates', async () => {
    const a1 = await upsertAccount({ slug: 'shop-a', displayName: '店铺A', mallId: '123' }, { path: regPath });
    assert.equal(a1.slug, 'shop-a');
    assert.ok(a1.createdAt);

    const a2 = await upsertAccount({ slug: 'shop-a', lastLoginAt: '2026-05-03T12:00:00Z' }, { path: regPath });
    assert.equal(a2.lastLoginAt, '2026-05-03T12:00:00Z');
    assert.equal(a2.displayName, '店铺A');
  });

  it('remove deletes account and resets default', async () => {
    await upsertAccount({ slug: 'shop-a', displayName: 'A' }, { setDefault: true, path: regPath });
    await removeAccount('shop-a', { path: regPath });
    const accounts = await listAccounts({ path: regPath });
    assert.equal(accounts.length, 0);
    const reg = await loadAccountRegistry({ path: regPath });
    assert.equal(reg.defaultAccount, null);
  });

  it('getAccount by slug', async () => {
    await upsertAccount({ slug: 'x', displayName: 'X Shop' }, { path: regPath });
    const account = await getAccount('x', { path: regPath });
    assert.equal(account.slug, 'x');
  });

  it('getAccount by displayName (unique)', async () => {
    await upsertAccount({ slug: 'x', displayName: '唯一店铺' }, { path: regPath });
    const account = await getAccount('唯一店铺', { allowDisplayName: true, path: regPath });
    assert.equal(account.slug, 'x');
  });

  it('getAccount by ambiguous displayName throws', async () => {
    await upsertAccount({ slug: 'a', displayName: '旗舰店' }, { path: regPath });
    await upsertAccount({ slug: 'b', displayName: '旗舰店' }, { path: regPath });
    await assert.rejects(
      () => getAccount('旗舰店', { allowDisplayName: true, path: regPath }),
      (err) => err.code === 'E_ACCOUNT_AMBIGUOUS',
    );
  });

  it('setDefaultAccount', async () => {
    await upsertAccount({ slug: 'a', displayName: 'A' }, { path: regPath });
    await upsertAccount({ slug: 'b', displayName: 'B' }, { path: regPath });
    await setDefaultAccount('b', { path: regPath });
    const reg = await loadAccountRegistry({ path: regPath });
    assert.equal(reg.defaultAccount, 'b');
  });

  it('CRUD idempotency PBT', async () => {
    await property(
      'crud-idempotency',
      gen.string({ minLen: 1, maxLen: 10, chars: 'abcdefghijklmnopqrstuvwxyz' }),
      async (slug) => {
        await upsertAccount({ slug, displayName: slug }, { path: regPath });
        const first = await getAccount(slug, { path: regPath });
        await upsertAccount({ slug, displayName: slug }, { path: regPath });
        const second = await getAccount(slug, { path: regPath });
        assert.equal(first.slug, second.slug);
        assert.ok(new Date(second.updatedAt) >= new Date(first.updatedAt));
        const all = await listAccounts({ path: regPath });
        const matches = all.filter((a) => a.slug === slug);
        assert.equal(matches.length, 1);
      },
      { runs: 20 },
    );
  });
});

describe('migrateLegacyToDefaultAccount', () => {
  let tmpDir;
  let regPath;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'pdd-mig-'));
    regPath = join(tmpDir, 'accounts.json');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('skips when registry already has accounts', async () => {
    await upsertAccount({ slug: 'existing' }, { path: regPath });
    const warnings = [];
    const result = await migrateLegacyToDefaultAccount({ warnings, path: regPath });
    assert.equal(result, false);
    assert.equal(warnings.length, 0);
  });
});
