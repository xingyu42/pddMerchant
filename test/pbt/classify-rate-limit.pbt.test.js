import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { classifyRateLimit } from '../../src/adapter/classify-rate-limit.js';

describe('classifyRateLimit PBT', () => {
  it('PROP-CR-1: idempotent — deep-frozen inputs produce identical output on double call', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.record({
            error_code: fc.oneof(fc.constant(54001), fc.integer(), fc.constant(null)),
            errorCode: fc.oneof(fc.constant(54001), fc.integer(), fc.constant(null)),
          }),
        ),
        (raw) => {
          if (raw != null) Object.freeze(raw);
          const r1 = classifyRateLimit(raw, null);
          const r2 = classifyRateLimit(raw, null);
          assert.strictEqual(r1, r2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('PROP-CR-2: HTTP 429 always returns http-429 regardless of body', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant({}),
          fc.record({ error_code: fc.integer() }),
        ),
        (raw) => {
          const response = { status: () => 429 };
          const result = classifyRateLimit(raw, response);
          assert.strictEqual(result, 'http-429');
        }
      ),
      { numRuns: 50 }
    );
  });
});
