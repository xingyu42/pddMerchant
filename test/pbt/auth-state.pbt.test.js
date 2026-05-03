import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { validateShape } from '../../src/adapter/auth-state.js';

describe('Auth-state PBT', () => {
  it('PROP-AS-2: shape validation — missing cookies or origins → reject', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant({}),
          fc.constant({ cookies: 'not-array' }),
          fc.constant({ origins: [] }),
          fc.constant({ cookies: [], origins: 'not-array' }),
          fc.constant({ cookies: null, origins: [] }),
          fc.record({
            cookies: fc.oneof(fc.constant(null), fc.string(), fc.integer()),
            origins: fc.oneof(fc.constant(null), fc.string(), fc.integer()),
          }),
        ),
        (state) => {
          const valid = validateShape(state);
          assert.strictEqual(valid, false, `should reject ${JSON.stringify(state)}`);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('PROP-AS-2 positive: valid shape accepted', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ name: fc.string(), value: fc.string() }), { minLength: 0, maxLength: 5 }),
        fc.array(fc.record({ origin: fc.string() }), { minLength: 0, maxLength: 3 }),
        (cookies, origins) => {
          const valid = validateShape({ cookies, origins });
          assert.strictEqual(valid, true);
        }
      ),
      { numRuns: 50 }
    );
  });
});
