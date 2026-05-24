import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('../src/adapter/mock-dispatcher.js', () => ({
  isMockEnabled: () => false,
  loadFixture: () => ({}),
}));

describe('category-resolver circuit breaker', () => {
  let resolvePddCategory;
  let _resetCategoryCircuit;

  beforeEach(async () => {
    vi.useFakeTimers();
    const mod = await import('../src/adapter/goods-publish/category-resolver.js');
    resolvePddCategory = mod.resolvePddCategory;
    _resetCategoryCircuit = mod._resetCategoryCircuit;
    _resetCategoryCircuit();

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network failure');
    }));
  });

  afterEach(() => {
    _resetCategoryCircuit();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function drainRetryCall() {
    const promise = resolvePddCategory('15000', '100', '200');
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(1100);
    await vi.advanceTimersByTimeAsync(2100);
    await vi.advanceTimersByTimeAsync(11000);
    return promise;
  }

  it('trips breaker after 3 consecutive failures', async () => {
    for (let i = 0; i < 3; i++) {
      await assert.rejects(
        () => drainRetryCall(),
        (err) => {
          assert.equal(err.code, 'E_NETWORK');
          return true;
        },
      );
    }

    // 4th call should hit the circuit breaker immediately (no fetch attempt)
    await assert.rejects(
      () => resolvePddCategory('15000', '100', '200'),
      (err) => {
        assert.equal(err.code, 'E_NETWORK');
        assert.ok(err.message.includes('熔断中'), `expected "熔断中" in message: ${err.message}`);
        return true;
      },
    );
  });

  it('throws E_NETWORK with cooldown message when tripped', async () => {
    // Trip the breaker with 3 failed calls
    for (let i = 0; i < 3; i++) {
      try { await drainRetryCall(); } catch { /* expected */ }
    }

    // Now should get circuit breaker error
    await assert.rejects(
      () => resolvePddCategory('15000', '100', '200'),
      (err) => {
        assert.equal(err.code, 'E_NETWORK');
        assert.equal(err.exitCode, 5);
        assert.ok(err.message.includes('熔断中'));
        assert.ok(err.hint.includes('冷却期'));
        return true;
      },
    );
  });

  it('_resetCategoryCircuit clears breaker state', async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      try { await drainRetryCall(); } catch { /* expected */ }
    }

    // Verify tripped
    await assert.rejects(
      () => resolvePddCategory('15000', '100', '200'),
      (err) => err.message.includes('熔断中'),
    );

    // Reset circuit breaker
    _resetCategoryCircuit();

    // Replace fetch with a successful response
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ code: 1, data: { root: '服饰', cates: ['服饰', '童装', '上衣'] } }),
    })));

    // Should work now (no circuit breaker error)
    const result = await resolvePddCategory('15000', '100', '200');
    assert.equal(result.cat_id, 15000);
    assert.ok(Array.isArray(result.cates));
  });
});

describe('category-resolver: response.ok=false increments failure counter', () => {
  let resolvePddCategory;
  let _resetCategoryCircuit;

  beforeEach(async () => {
    vi.useFakeTimers();
    const mod = await import('../src/adapter/goods-publish/category-resolver.js');
    resolvePddCategory = mod.resolvePddCategory;
    _resetCategoryCircuit = mod._resetCategoryCircuit;
    _resetCategoryCircuit();
  });

  afterEach(() => {
    _resetCategoryCircuit();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('HTTP 500 with JSON body triggers failure count, not reset', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })));

    const promise = resolvePddCategory('15000', '100', '200');
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(1100);
    await vi.advanceTimersByTimeAsync(2100);
    await vi.advanceTimersByTimeAsync(11000);

    await assert.rejects(
      () => promise,
      (err) => {
        assert.equal(err.code, 'E_NETWORK');
        return true;
      },
    );
  });

  it('HTTP 429 responses trip breaker after threshold', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    })));

    async function drain() {
      const p = resolvePddCategory('15000', '100', '200');
      p.catch(() => {});
      await vi.advanceTimersByTimeAsync(1100);
      await vi.advanceTimersByTimeAsync(2100);
      await vi.advanceTimersByTimeAsync(11000);
      return p;
    }

    for (let i = 0; i < 3; i++) {
      try { await drain(); } catch { /* expected */ }
    }

    await assert.rejects(
      () => resolvePddCategory('15000', '100', '200'),
      (err) => {
        assert.ok(err.message.includes('熔断中'));
        return true;
      },
    );
  });
});
