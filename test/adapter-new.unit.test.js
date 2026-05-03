import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { classifyRateLimit } from '../src/adapter/classify-rate-limit.js';
import { createRateLimiter } from '../src/adapter/rate-limiter.js';
import { createPageSession, normalizeKey } from '../src/adapter/page-session.js';
import { createFakeClock } from './pbt/helpers/fake-clock.js';
import { createFakeContext, createFakePage } from './pbt/helpers/fake-playwright.js';

describe('classifyRateLimit unit', () => {
  it('returns null for normal response', () => {
    assert.strictEqual(classifyRateLimit({ error_code: 0 }, null), null);
  });

  it('returns http-429 for 429 status', () => {
    assert.strictEqual(classifyRateLimit({}, { status: () => 429 }), 'http-429');
  });

  it('returns business-54001 for error_code 54001', () => {
    assert.strictEqual(classifyRateLimit({ error_code: 54001 }, null), 'business-54001');
  });

  it('returns business-54001 for string "54001"', () => {
    assert.strictEqual(classifyRateLimit({ errorCode: '54001' }, null), 'business-54001');
  });

  it('checks nested result.error_code', () => {
    assert.strictEqual(classifyRateLimit({ result: { error_code: 54001 } }, null), 'business-54001');
  });

  it('429 takes precedence over body 54001', () => {
    assert.strictEqual(
      classifyRateLimit({ error_code: 54001 }, { status: () => 429 }),
      'http-429'
    );
  });

  it('returns null for empty input', () => {
    assert.strictEqual(classifyRateLimit(null, null), null);
  });
});

describe('RateLimiter unit', () => {
  it('QPS=0 disables throttling', async () => {
    const limiter = createRateLimiter({ qps: 0 });
    for (let i = 0; i < 10; i++) {
      const { waitMs } = await limiter.acquire('test');
      assert.strictEqual(waitMs, 0);
    }
  });

  it('burst tokens available immediately', async () => {
    const clock = createFakeClock(0);
    const limiter = createRateLimiter({
      qps: 1, burst: 3,
      now: clock.now,
      sleep: clock.sleep,
    });

    for (let i = 0; i < 3; i++) {
      await limiter.acquire('test');
    }
    assert.strictEqual(clock.now(), 0, 'burst tokens should be instant');
  });

  it('_reset clears state', async () => {
    const clock = createFakeClock(0);
    const limiter = createRateLimiter({
      qps: 1, burst: 1,
      now: clock.now,
      sleep: clock.sleep,
    });

    await limiter.acquire('a');
    await limiter.acquire('b');
    const beforeReset = clock.now();
    assert.ok(beforeReset > 0, 'should have waited');

    limiter._reset();
    const t0 = clock.now();
    await limiter.acquire('c');
    assert.strictEqual(clock.now(), t0, 'after reset burst should be instant');
  });
});

describe('PageSession unit', () => {
  it('normalizeKey strips query and hash', () => {
    assert.strictEqual(
      normalizeKey('https://mms.pinduoduo.com/orders?page=1#top'),
      'https://mms.pinduoduo.com/orders'
    );
  });

  it('same URL within TTL → sibling', async () => {
    const clock = createFakeClock(1000);
    const ctx = createFakeContext();
    const session = createPageSession(ctx, { now: clock.now, ttlMs: 1000 });
    const page = createFakePage();

    const p1 = await session.goto(page, 'https://a.com/page', {});
    assert.strictEqual(p1, page);

    clock.advance(500);
    const p2 = await session.goto(page, 'https://a.com/page', {});
    assert.notStrictEqual(p2, page);

    assert.strictEqual(session.getSiblings().length, 1);
  });

  it('same URL after TTL → no sibling', async () => {
    const clock = createFakeClock(1000);
    const ctx = createFakeContext();
    const session = createPageSession(ctx, { now: clock.now, ttlMs: 1000 });
    const page = createFakePage();

    await session.goto(page, 'https://a.com/page', {});
    clock.advance(1500);
    const p2 = await session.goto(page, 'https://a.com/page', {});
    assert.strictEqual(p2, page);
    assert.strictEqual(session.getSiblings().length, 0);
  });

  it('different URL → no sibling', async () => {
    const clock = createFakeClock(1000);
    const ctx = createFakeContext();
    const session = createPageSession(ctx, { now: clock.now, ttlMs: 1000 });
    const page = createFakePage();

    await session.goto(page, 'https://a.com/page1', {});
    clock.advance(100);
    const p2 = await session.goto(page, 'https://a.com/page2', {});
    assert.strictEqual(p2, page);
  });

  it('closeAll cleans up siblings', async () => {
    const clock = createFakeClock(1000);
    const ctx = createFakeContext();
    const session = createPageSession(ctx, { now: clock.now, ttlMs: 1000 });
    const page = createFakePage();

    await session.goto(page, 'https://a.com/x', {});
    clock.advance(100);
    await session.goto(page, 'https://a.com/x', {});
    assert.strictEqual(session.getSiblings().length, 1);

    await session.closeAll();
    assert.strictEqual(session.getSiblings().length, 0);
  });
});
