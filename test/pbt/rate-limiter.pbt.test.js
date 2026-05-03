import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { createRateLimiter } from '../../src/adapter/rate-limiter.js';
import { createFakeClock } from './helpers/fake-clock.js';

describe('RateLimiter PBT', () => {
  it('PROP-RL-1: bounded — completions(t) ≤ burst + floor(qps × elapsed)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 2, max: 30 }),
        async (qps, burst, n) => {
          const clock = createFakeClock(0);
          const limiter = createRateLimiter({
            qps, burst,
            now: clock.now,
            sleep: clock.sleep,
          });

          const results = [];
          for (let i = 0; i < n; i++) {
            const { waitMs } = await limiter.acquire(`test-${i}`);
            results.push({ completedAt: clock.now(), waitMs });
          }

          for (let i = 0; i < results.length; i++) {
            const completedAt = results[i].completedAt;
            const completions = results.filter((r) => r.completedAt <= completedAt).length;
            const elapsed = completedAt / 1000;
            const upperBound = burst + Math.floor(qps * elapsed) + 1;
            assert.ok(
              completions <= upperBound,
              `At t=${completedAt}ms: ${completions} completions > bound ${upperBound} (qps=${qps}, burst=${burst})`
            );
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('PROP-RL-2: FIFO monotonic — earlier submissions complete no later', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 2, max: 15 }),
        async (qps, burst, n) => {
          const clock = createFakeClock(0);
          const limiter = createRateLimiter({
            qps, burst,
            now: clock.now,
            sleep: clock.sleep,
          });

          const completionTimes = [];
          for (let i = 0; i < n; i++) {
            await limiter.acquire(`test-${i}`);
            completionTimes.push(clock.now());
          }

          for (let i = 1; i < completionTimes.length; i++) {
            assert.ok(
              completionTimes[i] >= completionTimes[i - 1],
              `FIFO violation: t[${i}]=${completionTimes[i]} < t[${i - 1}]=${completionTimes[i - 1]}`
            );
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('PROP-RL-3: qps=0 → every acquire resolves instantly with waitMs===0', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),
        async (n) => {
          const limiter = createRateLimiter({ qps: 0 });
          for (let i = 0; i < n; i++) {
            const { waitMs } = await limiter.acquire('test');
            assert.strictEqual(waitMs, 0);
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});
