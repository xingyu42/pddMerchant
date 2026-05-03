import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { property, gen } from './_harness.js';
import { resolveAccountContext, accountMetaForEnvelope } from '../../src/infra/account-resolver.js';
import { upsertAccount, saveAccountRegistry, loadAccountRegistry } from '../../src/infra/account-registry.js';
import { ACCOUNT_REGISTRY_PATH } from '../../src/infra/paths.js';

describe('resolveAccountContext', () => {
  it('mutual exclusion: authStatePath + account throws E_USAGE', async () => {
    await assert.rejects(
      () => resolveAccountContext({ account: 'x', authStatePath: '/some/path' }),
      (err) => err.code === 'E_USAGE',
    );
  });

  it('explicit authStatePath returns it directly', async () => {
    const ctx = await resolveAccountContext({ authStatePath: '/explicit/path' });
    assert.equal(ctx.authPath, '/explicit/path');
    assert.equal(ctx.source, 'explicit-path');
    assert.equal(ctx.slug, null);
  });

  it('no registry falls back to legacy path', async () => {
    const ctx = await resolveAccountContext({});
    assert.ok(ctx.authPath);
    assert.ok(['legacy-fallback', 'default', 'auto-single'].includes(ctx.source));
  });
});

describe('resolveAccountContext PBT', () => {
  it('mutual exclusion: any account + any path → E_USAGE', async () => {
    await property(
      'mutual-exclusion',
      gen.tuple(
        gen.string({ minLen: 1, maxLen: 8 }),
        gen.string({ minLen: 1, maxLen: 20 }),
      ),
      async ([account, path]) => {
        await assert.rejects(
          () => resolveAccountContext({ account, authStatePath: path }),
          (err) => err.code === 'E_USAGE',
        );
      },
      { runs: 20 },
    );
  });
});

describe('accountMetaForEnvelope', () => {
  it('returns account info when slug present', () => {
    const meta = accountMetaForEnvelope({ slug: 'shop-a', displayName: '店铺A', source: 'flag' });
    assert.equal(meta.account, 'shop-a');
    assert.equal(meta.account_display_name, '店铺A');
  });

  it('returns empty when no slug', () => {
    const meta = accountMetaForEnvelope({ slug: null });
    assert.deepStrictEqual(meta, {});
  });

  it('returns empty for null', () => {
    assert.deepStrictEqual(accountMetaForEnvelope(null), {});
  });
});
