import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { throwIfAborted, remainingMs, abortableSleep, timeoutError } from '../../src/infra/abort.js';

describe('Abort / Timeout PBT', () => {
  it('PROP-AT-1: throwIfAborted does nothing when signal is null/undefined', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        throwIfAborted(null);
        throwIfAborted(undefined);
      }),
      { numRuns: 1 }
    );
  });

  it('PROP-AT-2: throwIfAborted throws E_TIMEOUT when signal is aborted', () => {
    const ac = new AbortController();
    ac.abort();
    assert.throws(
      () => throwIfAborted(ac.signal),
      (err) => err.code === 'E_TIMEOUT'
    );
  });

  it('PROP-AT-3: remainingMs returns Infinity when no deadline', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant({}), fc.constant({ deadlineAt: null }), fc.constant({ deadlineAt: undefined })),
        (ctx) => {
          assert.strictEqual(remainingMs(ctx), Infinity);
        }
      ),
      { numRuns: 3 }
    );
  });

  it('PROP-AT-4: remainingMs returns non-negative when deadline is set', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -5000, max: 60000 }),
        (offsetMs) => {
          const ctx = { deadlineAt: Date.now() + offsetMs };
          const ms = remainingMs(ctx);
          assert.ok(ms >= 0, `remainingMs must be >= 0, got ${ms}`);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('PROP-AT-5: abortableSleep rejects immediately when signal already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    try {
      await abortableSleep(10000, ac.signal);
      assert.fail('should have rejected');
    } catch (err) {
      assert.strictEqual(err.code, 'E_TIMEOUT');
    }
  });

  it('PROP-AT-6: abortableSleep resolves when not aborted', async () => {
    const start = Date.now();
    await abortableSleep(50, null);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 40, `Expected >= 40ms, got ${elapsed}`);
  });

  it('PROP-AT-7: abortableSleep rejects on mid-sleep abort', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 30);
    try {
      await abortableSleep(5000, ac.signal);
      assert.fail('should have rejected');
    } catch (err) {
      assert.strictEqual(err.code, 'E_TIMEOUT');
    }
  });

  it('PROP-AT-8: timeoutError produces PddCliError with E_TIMEOUT', () => {
    const err = timeoutError();
    assert.strictEqual(err.code, 'E_TIMEOUT');
    assert.strictEqual(err.name, 'PddCliError');
  });
});
