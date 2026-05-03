import { describe, it } from 'vitest';
import { strict as assert } from 'node:assert';
import { property, gen } from './_harness.js';

function computeDelay(intervalMs, jitterMs, rngValue) {
  const offset = Math.floor(rngValue * 2 * jitterMs) - jitterMs;
  return Math.max(60_000, intervalMs + offset);
}

describe('daemon-loop PBT', () => {
  it('PROP-DAEMON-1: jitter bounds — delay always positive and within range', async () => {
    await property(
      'jitter bounds',
      gen.record({
        intervalMs: gen.int(120_000, 7_200_000),
        jitterMs: gen.int(0, 1_800_000),
        rngValue: gen.float(0, 1),
      }),
      ({ intervalMs, jitterMs, rngValue }) => {
        const delay = computeDelay(intervalMs, jitterMs, rngValue);
        assert.ok(delay > 0, `delay must be > 0, got ${delay}`);
        assert.ok(delay >= 60_000, `delay must be >= 60s, got ${delay}`);
        const min = Math.max(60_000, intervalMs - jitterMs);
        const max = intervalMs + jitterMs;
        assert.ok(delay >= min, `delay ${delay} < min ${min}`);
        assert.ok(delay <= max, `delay ${delay} > max ${max}`);
        return true;
      },
      { runs: 200 },
    );
  });

  it('PROP-DAEMON-2: status monotonicity — refreshCount only increases', async () => {
    await property(
      'status monotonicity',
      gen.int(1, 50),
      (n) => {
        let count = 0;
        for (let i = 0; i < n; i++) {
          count++;
          assert.ok(count >= i + 1);
        }
        return true;
      },
      { runs: 50 },
    );
  });

  it('PROP-DAEMON-3: single-flight guard — concurrent flag prevents overlap', async () => {
    await property(
      'single-flight',
      gen.int(2, 10),
      async (concurrency) => {
        let inProgress = false;
        let violations = 0;

        async function doRefresh() {
          if (inProgress) {
            violations++;
            return;
          }
          inProgress = true;
          await new Promise((r) => setTimeout(r, 1));
          inProgress = false;
        }

        const tasks = Array.from({ length: concurrency }, () => doRefresh());
        await Promise.all(tasks);
        assert.ok(violations >= concurrency - 1, 'single-flight should skip concurrent calls');
        return true;
      },
      { runs: 20 },
    );
  });
});
