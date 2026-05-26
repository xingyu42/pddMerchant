import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { lognormalJitter, createRateLimiter } from '../src/adapter/rate-limiter.js';

describe('lognormalJitter', () => {
  it('returns 0 when sigma is 0', () => {
    assert.equal(lognormalJitter(100, 0), 0);
  });

  it('returns 0 when baseMs is 0', () => {
    assert.equal(lognormalJitter(0, 0.5), 0);
  });

  it('always returns >= 0', () => {
    const random = seedRandom(42);
    for (let i = 0; i < 200; i++) {
      const v = lognormalJitter(500, 0.8, random);
      assert.ok(v >= 0, `jitter was negative: ${v}`);
    }
  });

  it('is deterministic with seeded random', () => {
    const a = lognormalJitter(100, 0.5, seedRandom(1));
    const b = lognormalJitter(100, 0.5, seedRandom(1));
    assert.equal(a, b);
  });

  it('varies with different seeds', () => {
    const vals = new Set();
    for (let s = 1; s <= 20; s++) {
      vals.add(lognormalJitter(500, 0.5, seedRandom(s)));
    }
    assert.ok(vals.size > 5, `expected variety, got ${vals.size} unique values`);
  });
});

describe('createRateLimiter with jitter', () => {
  function makeClock(start = 0) {
    let t = start;
    return { now: () => t, advance: (ms) => { t += ms; } };
  }

  it('backward compat: no jitter when jitterSigma=0', async () => {
    const sleeps = [];
    const clock = makeClock();
    const limiter = createRateLimiter({
      qps: 1, burst: 1,
      now: () => clock.now(),
      sleep: async (ms) => { sleeps.push(ms); clock.advance(ms); },
    });
    await limiter.acquire('exhaust-burst');
    await limiter.acquire('test');
    assert.equal(sleeps.length, 1);
    assert.equal(sleeps[0], 1000);
  });

  it('adds jitter when jitterSigma > 0', async () => {
    const sleeps = [];
    const clock = makeClock();
    const limiter = createRateLimiter({
      qps: 1, burst: 1, jitterSigma: 0.5,
      now: () => clock.now(),
      sleep: async (ms) => { sleeps.push(ms); clock.advance(ms); },
      random: seedRandom(42),
    });
    await limiter.acquire('exhaust-burst');
    await limiter.acquire('test');
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0] >= 1000, `expected >= 1000, got ${sleeps[0]}`);
  });

  it('healthMultiplier slows down effective QPS', async () => {
    const sleeps = [];
    const clock = makeClock();
    const limiter = createRateLimiter({
      qps: 2, burst: 1,
      healthMultiplier: () => 0.5,
      now: () => clock.now(),
      sleep: async (ms) => { sleeps.push(ms); clock.advance(ms); },
    });
    await limiter.acquire('exhaust-burst');
    await limiter.acquire('test');
    assert.equal(sleeps[0], 1000);
  });

  it('healthMultiplier=null uses base QPS', async () => {
    const sleeps = [];
    const clock = makeClock();
    const limiter = createRateLimiter({
      qps: 2, burst: 1,
      healthMultiplier: null,
      now: () => clock.now(),
      sleep: async (ms) => { sleeps.push(ms); clock.advance(ms); },
    });
    await limiter.acquire('exhaust-burst');
    await limiter.acquire('test');
    assert.equal(sleeps[0], 500);
  });
});

function seedRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}
