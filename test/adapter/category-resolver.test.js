import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import { createCategoryResolver } from '../../src/adapter/goods-publish/category-resolver.js';
import { ExitCodes, PddCliError } from '../../src/infra/errors.js';

describe('CategoryResolverPort (instance-scoped)', () => {
  it('resolves category ids to normalized category fields and searchText', async () => {
    const fetchMock = vi.fn(async (url) => {
      assert.equal(url, 'https://category.example/api/v1/crx/PddCate?last_cate_id=1003');
      return {
        ok: true,
        json: async () => ({
          code: 1,
          data: {
            root: '服饰',
            cates: ['服饰', '女装', 'T恤'],
          },
        }),
      };
    });

    const resolver = createCategoryResolver({
      apiBase: 'https://category.example',
      fetch: fetchMock,
      sleep: async () => {},
    });

    const result = await resolver.resolve({ catId1: '1001', catId2: '1002', catId3: '1003' });
    assert.deepEqual(result, {
      root: '服饰',
      cates: ['服饰', '女装', 'T恤'],
      cat_id: 1003,
      cat_ids: [1001, 1002, 1003, null],
      cats: ['服饰', '女装', 'T恤', null],
      searchText: '服饰 > 女装 > T恤',
    });
  });

  it('keeps circuit-breaker state strictly instance-scoped with no module singleton', async () => {
    let nowMs = 1_700_000_000_000;
    const sleepCalls = [];
    const failingFetch = vi.fn(async () => {
      throw new Error('upstream down');
    });
    const okFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ code: 1, data: { root: '服饰', cates: ['服饰', '男装', '衬衫'] } }),
    }));

    const resolverA = createCategoryResolver({
      apiBase: 'https://category.example',
      fetch: failingFetch,
      sleep: async (ms) => { sleepCalls.push(ms); },
      now: () => nowMs,
      failureThreshold: 2,
      cooldownMs: 30_000,
    });
    const resolverB = createCategoryResolver({
      apiBase: 'https://category.example',
      fetch: okFetch,
      sleep: async () => {},
      now: () => nowMs,
      failureThreshold: 2,
      cooldownMs: 30_000,
    });

    await assert.rejects(resolverA.resolve({ catId3: 1003 }), { code: 'E_NETWORK' });
    await assert.rejects(resolverA.resolve({ catId3: 1003 }), { code: 'E_NETWORK' });
    assert.deepEqual(sleepCalls, [1000, 2000, 1000, 2000]);

    // resolverA is now tripped, while resolverB remains unaffected.
    await assert.rejects(
      resolverA.resolve({ catId3: 1003 }),
      (err) => err instanceof PddCliError && err.code === 'E_NETWORK' && /熔断中/.test(err.message),
    );
    const resB = await resolverB.resolve({ catId3: 2003 });
    assert.equal(resB.searchText, '服饰 > 男装 > 衬衫');

    // After cooldown expires on resolverA, it allows requests again.
    nowMs += 30_001;
    await assert.rejects(resolverA.resolve({ catId3: 1003 }), { code: 'E_NETWORK' });
  });

  it('aborts retry sleep immediately via AbortSignal without tripping circuit', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      throw new Error('transient error');
    });
    const resolver = createCategoryResolver({
      apiBase: 'https://category.example',
      fetch: fetchMock,
      failureThreshold: 1,
    });

    const pending = resolver.resolve({ catId3: 1003 }, { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();

    await assert.rejects(
      pending,
      (err) => err instanceof PddCliError && err.code === 'E_TIMEOUT' && err.exitCode === ExitCodes.NETWORK,
    );
    assert.equal(fetchMock.mock.calls.length, 1);
  });

  it('maps non-1 business response code to E_BUSINESS without retrying', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ code: 0, data: null }),
    }));
    const resolver = createCategoryResolver({
      apiBase: 'https://category.example',
      fetch: fetchMock,
      sleep: async () => {},
    });

    await assert.rejects(
      resolver.resolve({ catId3: 1003 }),
      (err) => err instanceof PddCliError && err.code === 'E_BUSINESS' && err.exitCode === ExitCodes.BUSINESS,
    );
    assert.equal(fetchMock.mock.calls.length, 1);
  });
});
