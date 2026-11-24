import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import { createWriteThrottle } from '../../src/adapter/goods-publish/draft-editor/write-throttle.js';
import { ExitCodes, PddCliError } from '../../src/infra/errors.js';

describe('createWriteThrottle (private abortable write throttle)', () => {
  it('waits with zero delay when disabled or in fixture/test mode by default', async () => {
    const sleep = vi.fn(async () => {});
    const fixtureThrottle = createWriteThrottle({ mode: 'fixture', tokensPerMinute: 12, sleep });
    const defaultVitestThrottle = createWriteThrottle({ tokensPerMinute: 12, sleep });
    const disabledThrottle = createWriteThrottle({ enabled: false, tokensPerMinute: 12, sleep });

    await fixtureThrottle.run('publish.submit', async () => 'ok-fixture');
    await defaultVitestThrottle.run('publish.submit', async () => 'ok-test');
    await disabledThrottle.run('publish.submit', async () => 'ok-disabled');

    assert.equal(sleep.mock.calls.length, 0);
  });

  it('consumes tokens, applies jitter, refills on interval, and stays instance-scoped when enabled', async () => {
    let nowMs = 1_000_000;
    const sleeps = [];
    const sleep = async (ms) => {
      sleeps.push(ms);
      nowMs += ms;
    };

    const throttleA = createWriteThrottle({
      enabled: true,
      tokensPerMinute: 6, // 10_000ms per token
      burst: 1,
      jitterMs: [2000, 8000],
      now: () => nowMs,
      sleep,
      random: () => 0.5, // jitter = 5000ms
    });
    const throttleB = createWriteThrottle({
      enabled: true,
      tokensPerMinute: 6,
      burst: 1,
      jitterMs: [2000, 8000],
      now: () => nowMs,
      sleep,
      random: () => 0,
    });

    await throttleA.run('publish.create_draft', async () => {});
    await throttleA.run('publish.submit', async () => {});
    await throttleB.run('publish.create_draft', async () => {});

    // 1st call on A: 1 burst token available -> jitter 5000ms (nowMs += 5000)
    // 2nd call on A: 0 tokens, elapsed 5000 < 10000 -> wait 5000ms to refill, then jitter 5000ms
    // 1st call on B: independent burst token -> jitter 2000ms
    assert.deepEqual(sleeps, [5000, 5000, 5000, 2000]);
  });

  it('interrupts sleep immediately when AbortSignal aborts', async () => {
    vi.useFakeTimers();
    const throttle = createWriteThrottle({
      enabled: true,
      tokensPerMinute: 12,
      burst: 1,
      jitterMs: [5000, 5000],
    });

    const controller = new AbortController();
    const fn = vi.fn(async () => 'should-not-run');
    const pending = throttle.run('publish.submit', fn, controller.signal);

    await vi.advanceTimersByTimeAsync(100);
    controller.abort();

    await assert.rejects(
      pending,
      (err) => err instanceof PddCliError && err.code === 'E_TIMEOUT' && err.exitCode === ExitCodes.NETWORK,
    );
    assert.equal(fn.mock.calls.length, 0);
  });
});
